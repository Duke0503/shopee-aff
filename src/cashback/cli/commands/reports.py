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
            period_is_withheld=args.withheld,
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
            period_is_withheld=args.withheld,
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
