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


def cmd_payouts(cfg: Config, _args: argparse.Namespace) -> int:
    with ledger.connect(cfg.db_path) as conn:
        rows = ledger.orders_awaiting_payout(conn)
    if not rows:
        print("Nothing awaiting payout.")
        return 0
    print(f"{len(rows)} order(s) approved and awaiting transfer:\n")
    total = 0
    for r in rows:
        total += r["cashback_amount"] or 0
        print(f"  {r['order_id']:<16} {r['display_name'] or r['customer_id']:<20}"
              f" {_vnd(r['cashback_amount']):>14}"
              f"  {r['bank_name'] or '?'} {r['bank_account'] or '?'}")
    print(f"\n  total: {_vnd(total)}")
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
