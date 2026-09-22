"""Reading Shopee's exported conversion report and reconciling it."""

from __future__ import annotations

import argparse

from ...core.config import Config
from ...ledger import repository as ledger
from ..formatting import _pct, _vnd


def cmd_inspect_report(cfg: Config, args: argparse.Namespace) -> int:
    """Print the headers found in a downloaded report, plus a guessed mapping."""
    from pathlib import Path

    from ...shopee.report_importer import MAPPING_FILE, ColumnMapping, detect_mapping, read_headers

    path = Path(args.file)
    headers = read_headers(path)
    if not headers:
        print(f"No header row found in {path}")
        return 1

    print(f"{len(headers)} column(s) in {path.name}:\n")
    for i, header in enumerate(headers, 1):
        print(f"  {i:>2}. {header}")

    guess = detect_mapping(headers)
    print("\nGuessed mapping:")
    for name, value in guess.__dict__.items():
        print(f"  {name:<12} -> {value or '(not found)'}")

    missing = guess.missing_required()
    target = Path(MAPPING_FILE)
    guess.save(target)
    print(f"\nWritten to {target}. Edit it by hand where the guess is wrong.")
    if missing:
        print(f"STILL MISSING (required): {', '.join(missing)}")
        return 1
    return 0


def cmd_reconcile(cfg: Config, args: argparse.Namespace) -> int:
    from pathlib import Path

    from ...shopee import reconciliation as reconcile
    from ...shopee.report_importer import MAPPING_FILE, ColumnMapping, read_rows

    if args.live:
        return _reconcile_live(cfg, args)

    if not args.file:
        print("Give --file <report.csv>, or --live to read from the dashboard.")
        return 1

    mapping = ColumnMapping.load(Path(MAPPING_FILE))
    missing = mapping.missing_required()
    if missing:
        print(f"Column mapping incomplete, missing: {', '.join(missing)}")
        print(f"Run: cashback inspect-report <file>   then edit {MAPPING_FILE}")
        return 1

    path = Path(args.file)
    with ledger.connect(cfg.db_path) as conn:
        rows = list(read_rows(path, mapping))
        if args.dry_run:
            print(f"Dry run: {len(rows)} row(s) parsed from {path.name}")
            for row in rows[:10]:
                print(f"  {row.order_id:<18} {row.status:<10}"
                      f" commission={row.commission} sub_id1={row.customer_code!r}")
            if len(rows) > 10:
                print(f"  ... and {len(rows) - 10} more")
            return 0

        outcome = reconcile.run(
            conn,
            rows,
            cashback_rate=cfg.cashback_rate,
            tax_policy=cfg.tax_policy,
            period_is_withheld=args.withheld or cfg.period_is_withheld,
            source=f"csv:{path.name}",
        )

    print(outcome.summary())
    if outcome.notify_approved:
        print(f"\nTo notify (approved): {len(outcome.notify_approved)}")
    if outcome.notify_rejected:
        print(f"To notify (rejected): {len(outcome.notify_rejected)}")
    if outcome.needs_review:
        print(f"\n{outcome.needs_review} row(s) need a human. "
              f"See the manual_review table.")
    return 0


def _reconcile_live(cfg: Config, args: argparse.Namespace) -> int:
    """Read the report straight from the dashboard, no CSV export.

    Same reconciliation afterwards -- only where the rows come from
    differs, so a live run and a file run cannot drift apart in how they
    decide anything.
    """
    from ...shopee import reconciliation as reconcile, report_reader
    from ...shopee.browser_bridge import serve_in_background
    from ...worker import runner as worker
    from .browser import _bridge_for

    if not cfg.bridge_token:
        print("BRIDGE_TOKEN is empty. Run: cashback setup-token")
        return 1

    bridge = _bridge_for(cfg)
    server = serve_in_background(bridge, args.port or cfg.bridge_port)
    print(f"Bridge up on 127.0.0.1:{args.port or cfg.bridge_port}. "
          "Waiting for the extension...")
    if not worker.wait_for_extension(bridge, 45):
        server.shutdown()
        print()
        print("The extension never checked in. Open the bot browser first:")
        print("  powershell scripts/start-browser.ps1")
        return 1

    try:
        print(f"Reading the last {args.days} day(s) of conversions...")
        rows = report_reader.read(bridge, days=args.days)
    except RuntimeError as exc:
        server.shutdown()
        print(f"Could not read the report: {exc}")
        return 1

    print(f"{len(rows)} conversion(s) found.")
    print()
    unknown = [r for r in rows if r.status == "unknown"]
    if unknown:
        print(f"{len(unknown)} row(s) carry a status this system does not "
              "recognise. They go to manual review rather than to a payout "
              "decision.")

    if args.dry_run:
        for row in rows[:20]:
            # An unpaid order carries a commission figure that Shopee shows
            # as a dash: it is what the order would earn, not what it has.
            paid = report_reader.buyer_has_paid(row.raw)
            money = (f"commission={row.commission}" if paid
                     else f"commission={row.commission} (not paid for yet)")
            print(f"  {row.order_id:<18} {row.status:<10}"
                  f" value={row.order_value} {money}"
                  f" sub_id1={row.customer_code!r} sub_id2={row.request_code!r}")
        if len(rows) > 20:
            print(f"  ... and {len(rows) - 20} more")
        print()
        print("Dry run: nothing was written.")
        server.shutdown()
        return 0

    with ledger.connect(cfg.db_path) as conn:
        outcome = reconcile.run(
            conn, rows,
            cashback_rate=cfg.cashback_rate,
            tax_policy=cfg.tax_policy,
            period_is_withheld=args.withheld or cfg.period_is_withheld,
            source="dashboard:live",
        )
    server.shutdown()

    print(outcome.summary())
    if outcome.notify_approved:
        print()
        print(f"To notify (approved): {len(outcome.notify_approved)}")
    if outcome.notify_rejected:
        print(f"To notify (rejected): {len(outcome.notify_rejected)}")
    if outcome.needs_review:
        print()
        print(f"{outcome.needs_review} row(s) need a human. "
              "See the manual_review table.")
    return 0


def cmd_review(cfg: Config, args: argparse.Namespace) -> int:
    """Rows reconciliation refused to guess at, and what to do with them.

    These were only ever reachable by opening the database by hand. A
    parked row is money that may be owed to a real customer, so leaving
    it visible solely to whoever remembers the table name is how a
    customer goes unpaid without anyone ever deciding to skip them.

    Most parked rows are parked for one of two reasons: an unfamiliar
    status value, or a sub_id that matches no customer. The first kind
    is usually fixed by a later release, which is why --retry exists:
    the raw row was stored, so it can be pushed back through the current
    mapping rather than judged by hand.
    """
    import json

    if args.resolve:
        return cmd_review_resolve(cfg, args)

    with ledger.connect(cfg.db_path) as conn:
        rows = conn.execute(
            "SELECT id, order_id, reason, created_at, raw_data"
            "  FROM manual_review WHERE resolved=0 ORDER BY id"
        ).fetchall()

    if not rows:
        print("Nothing waiting for a human.")
        return 0

    if args.retry:
        return _retry_parked(cfg, rows)

    print(f"{len(rows)} row(s) need a decision\n")
    for row in rows:
        raw = {}
        try:
            raw = json.loads(row["raw_data"])
        except (ValueError, TypeError):
            pass
        print(f"  #{row['id']}  {row['order_id'] or '(no order id)'}")
        print(f"      reason  : {row['reason']}")
        print(f"      seen    : {row['created_at'][:16]}")
        if raw.get("utm_content"):
            print(f"      sub_ids : {raw['utm_content']}")
        item = _first_item(raw)
        if item:
            print(f"      item    : {item.get('item_name', '')[:60]}")
            print(f"      status  : {item.get('display_item_status', '?')}"
                  f"  (order: {_order_status(raw)})")
        print()

    print("cashback review --retry      push them back through the current "
          "mapping\ncashback review --resolve N  mark one as dealt with by hand")
    return 0


def _first_item(raw: dict) -> dict | None:
    for order in raw.get("orders") or []:
        for item in order.get("items") or []:
            return item
    return None


def _order_status(raw: dict) -> str:
    for order in raw.get("orders") or []:
        return str(order.get("order_status", "?"))
    return "?"


def _retry_parked(cfg: Config, rows) -> int:
    """Re-apply stored raw rows through today's mapping.

    A row parked by a mapping gap stays parked forever once the gap is
    closed, because nothing re-reads it. This does, and clears only the
    rows that actually went somewhere this time.
    """
    import json

    from ...shopee import reconciliation as reconcile
    from ...shopee.report_reader import _row_to_report_row

    parsed, unparsable = [], 0
    keep = {}
    for row in rows:
        try:
            raw = json.loads(row["raw_data"])
            report_row = _row_to_report_row(raw)
        except Exception:
            unparsable += 1
            continue
        if report_row.status == "unknown" or not report_row.customer_code:
            continue                       # still not something to act on
        parsed.append(report_row)
        keep[report_row.order_id] = row["id"]

    if not parsed:
        print(f"None of the {len(rows)} parked row(s) can be applied yet.")
        if unparsable:
            print(f"({unparsable} could not be parsed at all.)")
        return 0

    with ledger.connect(cfg.db_path) as conn:
        outcome = reconcile.run(
            conn, parsed,
            cashback_rate=cfg.cashback_rate,
            tax_policy=cfg.tax_policy,
            period_is_withheld=cfg.period_is_withheld,
            source="manual-review:retry",
        )
        # Clear only what the ledger actually took. A row that came back
        # needing review is still parked, under a fresh entry.
        for order_id, review_id in keep.items():
            if ledger.get_order(conn, order_id) is not None:
                conn.execute(
                    "UPDATE manual_review SET resolved=1 WHERE id=?",
                    (review_id,))
        conn.commit()

    print(outcome.summary())
    print(f"\n{len(parsed)} parked row(s) retried.")
    return 0


def cmd_review_resolve(cfg: Config, args: argparse.Namespace) -> int:
    """Mark a parked row as dealt with, without touching the ledger."""
    with ledger.connect(cfg.db_path) as conn:
        changed = conn.execute(
            "UPDATE manual_review SET resolved=1 WHERE id=? AND resolved=0",
            (args.resolve,)).rowcount
        conn.commit()
    if not changed:
        print(f"No unresolved row #{args.resolve}.")
        return 1
    print(f"Row #{args.resolve} marked resolved. The ledger was not changed.")
    return 0


def cmd_sync_accesstrade(cfg: Config, args: argparse.Namespace) -> int:
    """Synchronize TikTok Shop orders from AccessTrade Orders API."""
    from ...providers.accesstrade_reconciler import sync_accesstrade_orders

    print("Synchronizing TikTok Shop orders via AccessTrade API...")
    days = getattr(args, "days", 30)
    summary = sync_accesstrade_orders(cfg, since_days=days)

    if summary.error:
        print(f"Sync Notice: {summary.error}")
        return 1

    print(f"Orders read from AccessTrade: {summary.rows_read}")
    print(f"  New orders inserted:        {summary.orders_new}")
    print(f"  Orders newly approved:      {summary.approved}")
    print(f"  Orders newly rejected:      {summary.rejected}")
    print(f"  Orders unchanged/skipped:   {summary.skipped}")
    return 0
