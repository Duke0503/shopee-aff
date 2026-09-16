"""Commands that read or change the ledger directly."""

from __future__ import annotations

import argparse

from ...core.config import Config
from ...ledger import repository as ledger
from ..formatting import _pct, _vnd


def cmd_init(cfg: Config, _args: argparse.Namespace) -> int:
    ledger.initialise(cfg.db_path)
    print(f"Ledger ready at {cfg.db_path}")
    print(cfg.describe_mode())
    return 0


def cmd_status(cfg: Config, _args: argparse.Namespace) -> int:
    print(f"Mode      : {cfg.describe_mode()}")
    print(f"Database  : {cfg.db_path}")
    print(f"Cashback  : {cfg.cashback_rate:.0%} of approved commission")
    print(f"Tax policy: {cfg.tax_policy.value}")
    print(f"Advertise : {cfg.advertised_cashback_rate:.0%}  <- the honest figure")
    print(f"Auto payout: {cfg.auto_payout}")
    return 0


def cmd_payouts(cfg: Config, args: argparse.Namespace) -> int:
    """Who is owed money, grouped by person rather than by order."""
    from ...ledger import payouts

    with ledger.connect(cfg.db_path) as conn:
        owed = payouts.collect(conn)

    if not owed:
        print("Nothing awaiting payout.")
        return 0

    ready, waiting = payouts.split_by_threshold(owed)

    if ready:
        print(f"READY TO PAY  ({len(ready)} customer(s), "
              f"threshold {_vnd(payouts.MIN_PAYOUT_VND)})")
        print()
        for entry in ready:
            print(f"  {entry.customer_id:<8} {entry.display_name or '-':<20}"
                  f" {_vnd(entry.amount):>14}"
                  f"  {entry.bank_name} {entry.bank_account}")
            print(f"           {len(entry.order_ids)} order(s): "
                  f"{', '.join(entry.order_ids)}")
        print()
        print(f"  total: {_vnd(sum(e.amount for e in ready))}")

    if waiting:
        print()
        print(f"STILL ACCUMULATING  ({len(waiting)} customer(s))")
        print()
        for entry in waiting:
            if not entry.has_bank_details:
                why = "no bank details yet"
            else:
                short = payouts.MIN_PAYOUT_VND - entry.amount
                why = f"{_vnd(short)} short of the threshold"
            print(f"  {entry.customer_id:<8} {entry.display_name or '-':<20}"
                  f" {_vnd(entry.amount):>14}   {why}")

    if args.qr:
        return _write_qr_page(ready, waiting)
    return 0


def _write_qr_page(ready, waiting) -> int:
    """One page of scannable transfers, opened in a browser and paid off."""
    from pathlib import Path

    from ...ledger import payouts

    if not ready:
        print()
        print("No QR page written: nobody has cleared the threshold yet.")
        return 0

    cards = []
    manual = []
    for entry in ready:
        url = entry.qr_url()
        if url is None:
            manual.append(entry)
            continue
        cards.append(
            "<article>"
            f"<h2>{entry.display_name or entry.customer_id}</h2>"
            f"<p class=amount>{_vnd(entry.amount)}</p>"
            f"<img src=\"{url}\" alt=\"QR\">"
            f"<p class=meta>{entry.bank_name} &middot; {entry.bank_account}"
            f"<br>{entry.account_holder}"
            f"<br><code>{entry.reference}</code></p>"
            f"<p class=orders>{len(entry.order_ids)} order(s): "
            f"{', '.join(entry.order_ids)}</p>"
            "</article>"
        )

    warning = ""
    if manual:
        rows = "".join(
            f"<li>{e.customer_id} &mdash; {e.display_name} &mdash; "
            f"{_vnd(e.amount)} &mdash; <b>{e.bank_name}</b> {e.bank_account}</li>"
            for e in manual)
        warning = (
            "<section class=manual><h2>Transfer these by hand</h2>"
            "<p>The bank written on the account could not be matched to "
            "exactly one bank, so no QR was made. Guessing it could send "
            "the money to a stranger holding the same account number at a "
            "different bank.</p><ul>" + rows + "</ul></section>")

    page = (
        "<!doctype html><meta charset=utf-8>"
        "<title>Cashback payouts</title>"
        "<style>"
        "body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:24px;"
        "background:#f6f7f9;color:#111}"
        "h1{font-size:20px;margin:0 0 4px}"
        ".sub{color:#666;margin:0 0 24px}"
        ".grid{display:grid;gap:16px;"
        "grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}"
        "article{background:#fff;border:1px solid #e3e5e8;border-radius:12px;"
        "padding:16px;text-align:center}"
        "article h2{font-size:15px;margin:0 0 2px}"
        ".amount{font-size:24px;font-weight:700;margin:0 0 10px}"
        "img{width:100%;max-width:220px;border-radius:8px}"
        ".meta{font-size:13px;color:#555;margin:10px 0 0}"
        ".orders{font-size:12px;color:#888;margin:6px 0 0}"
        "code{background:#f0f1f3;padding:1px 5px;border-radius:4px;font-size:12px}"
        ".manual{background:#fff8e6;border:1px solid #f0d9a0;border-radius:12px;"
        "padding:16px;margin-top:24px}"
        ".manual p{font-size:14px;color:#664d00}"
        "</style>"
        f"<h1>Cashback payouts &mdash; {len(cards)} to transfer</h1>"
        f"<p class=sub>Total {_vnd(sum(e.amount for e in ready))}. "
        "Scan each with your banking app, confirm, then run "
        "<code>cashback pay &lt;order-id&gt;</code> for that customer's "
        "orders.</p>"
        "<div class=grid>" + "".join(cards) + "</div>" + warning
    )

    out = Path("payouts.html")
    out.write_text(page, encoding="utf-8")
    print()
    print(f"QR page written to {out.resolve()}")
    print(f"  {len(cards)} scannable, {len(manual)} need a manual transfer")
    return 0


def cmd_pay(cfg: Config, args: argparse.Namespace) -> int:
    with ledger.connect(cfg.db_path) as conn:
        ok = ledger.mark_paid(conn, args.order_id, args.note or "")
    if ok:
        print(f"{args.order_id}: marked paid")
        return 0
    print(f"{args.order_id}: refused. Either not approved yet, or already paid.")
    return 1


def cmd_expire(cfg: Config, _args: argparse.Namespace) -> int:
    with ledger.connect(cfg.db_path) as conn:
        count = ledger.expire_stale_requests(conn, cfg.link_attribution_days)
    print(f"{count} link request(s) expired after {cfg.link_attribution_days} days")
    return 0


def cmd_links(cfg: Config, args: argparse.Namespace) -> int:
    from ...ledger import repository as ledger

    with ledger.connect(cfg.db_path) as conn:
        rows = conn.execute(
            "SELECT request_id, customer_id, status, affiliate_url, created_at"
            " FROM link_requests ORDER BY created_at DESC LIMIT ?",
            (args.limit,),
        ).fetchall()
        waiting = len(ledger.pending_link_jobs(conn, limit=1000))

    if not rows:
        print("No link requests yet.")
        return 0

    print(f"{waiting} awaiting a link\n")
    for r in rows:
        link = r["affiliate_url"] or "-"
        print(f"  {r['request_id']:<16} {r['customer_id']:<10} "
              f"{r['status']:<10} {link}")
    return 0


def cmd_add_customer(cfg: Config, args: argparse.Namespace) -> int:
    from ...ledger import repository as ledger
    from ...core.identifiers import next_customer_id

    with ledger.connect(cfg.db_path) as conn:
        customer_id = args.id or next_customer_id(conn)
        ledger.add_customer(
            conn,
            customer_id,
            display_name=args.name or "",
            zalo_user_id=args.zalo_id or "",
            private_chat_id=args.chat_id or "",
        )
        if args.bank and args.account and args.holder:
            ledger.set_bank_details(
                conn, customer_id, args.bank, args.account, args.holder
            )
        ready, why = ledger.can_accept_orders(conn, customer_id)

    print(f"customer {customer_id}")
    print(f"  ready for orders: {ready}" + (f" ({why})" if not ready else ""))
    return 0


def cmd_request(cfg: Config, args: argparse.Namespace) -> int:
    """Queue a link request. This is what the Zalo bot will call."""
    from ...ledger import repository as ledger
    from ...core.identifiers import new_request_id

    with ledger.connect(cfg.db_path) as conn:
        ready, why = ledger.can_accept_orders(conn, args.customer_id)
        if not ready and not args.force:
            print(f"refused: {why}")
            print("  use --force to queue anyway (payout may strand later)")
            return 1

        request_id = new_request_id()
        ledger.record_link_request(
            conn,
            request_id=request_id,
            customer_id=args.customer_id,
            source_url=args.url,
            affiliate_url=None,
            estimated_commission=None,
            channel=args.channel,
        )

    print(f"queued {request_id} for {args.customer_id}")
    print("  the worker will pick it up once the batch window elapses")
    return 0


def cmd_forget(cfg: Config, args: argparse.Namespace) -> int:
    """Erase a customer completely. Matches on id, name or Zalo id."""
    from ...ledger import repository as ledger

    with ledger.connect(cfg.db_path) as conn:
        needle = args.who
        row = conn.execute(
            "SELECT customer_id, display_name FROM customers"
            " WHERE customer_id=? OR zalo_user_id=? OR private_chat_id=?"
            "    OR display_name LIKE ?",
            (needle, needle, needle, f"%{needle}%"),
        ).fetchone()

        if row is None:
            print(f"No customer matches {needle!r}.")
            print("\nCurrently on file:")
            for r in conn.execute(
                "SELECT customer_id, display_name FROM customers"
            ):
                print(f"  {r['customer_id']}  {r['display_name']}")
            return 1

        outcome = ledger.forget_customer(conn, row["customer_id"], force=args.force)

    if not outcome.get("deleted"):
        print(f"Refused: {row['display_name']} still has "
              f"{outcome['owed_orders']} approved order(s) awaiting payout, "
              f"worth {outcome['owed_amount']:,} VND.")
        print("Settle or write those off first, then re-run with --force.")
        return 1

    print(f"Erased {row['customer_id']} ({outcome['display_name']}): "
          f"{outcome['link_requests']} link request(s), "
          f"{outcome['orders']} order(s), and all history.")
    return 0


def cmd_reset(cfg: Config, args: argparse.Namespace) -> int:
    """Wipe the whole ledger. For testing only."""
    from ...ledger import repository as ledger

    if not args.yes:
        with ledger.connect(cfg.db_path) as conn:
            counts = {
                t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                for t in ("customers", "link_requests", "orders")
            }
        print("This deletes everything in " + str(cfg.db_path) + ":")
        for name, n in counts.items():
            print(f"  {name}: {n}")
        print("\nRe-run with --yes to confirm.")
        return 1

    if cfg.db_path.exists():
        cfg.db_path.unlink()
    for suffix in ("-wal", "-shm"):
        extra = cfg.db_path.with_name(cfg.db_path.name + suffix)
        if extra.exists():
            extra.unlink()
    ledger.initialise(cfg.db_path)
    print(f"Ledger wiped and recreated at {cfg.db_path}")
    return 0
