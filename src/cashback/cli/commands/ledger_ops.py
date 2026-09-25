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
    # The headline is defensible only because the condition is stated
    # wherever it appears. Printing the headline alone hides the half of
    # the arrangement the operator has to keep honouring.
    if cfg.reduced_cashback_rate < cfg.cashback_rate:
        print(f"Advertise : {cfg.advertised_cashback_rate:.0%}, dropping to "
              f"{cfg.reduced_cashback_rate:.0%} in a withheld period")
        state = "withheld" if cfg.period_is_withheld else "not withheld"
        print(f"This period: {state}  (PAYOUT_PERIOD_WITHHELD)")
    else:
        print(f"Advertise : {cfg.advertised_cashback_rate:.0%}, unconditional")
    print(f"Auto payout: {cfg.auto_payout}")
    return 0


def cmd_payouts(cfg: Config, args: argparse.Namespace) -> int:
    """Who is owed money, grouped by person rather than by order."""
    from ...ledger import payouts

    from ...web import dashboard

    with ledger.connect(cfg.db_path) as conn:
        owed = payouts.collect(conn)
    # Orders Shopee has not settled yet are not payable and must never be
    # counted as owed -- but printing "nothing awaiting payout" while real
    # orders are in flight reads as "nothing is happening", which is how
    # an operator concludes the bot has stopped working.
    pipeline = dashboard.snapshot(cfg.db_path, cfg.advertised_cashback_rate)

    if not owed and not pipeline["pipeline"]:
        print("Nothing awaiting payout, and nothing in flight.")
        return 0

    ready, blocked = payouts.split_by_bank_details(owed)

    if ready:
        print(f"READY TO PAY  ({len(ready)} customer(s))")
        print()
        for entry in ready:
            print(f"  {entry.customer_id:<8} {entry.display_name or '-':<20}"
                  f" {_vnd(entry.amount):>14}"
                  f"  {entry.bank_name} {entry.bank_account}")
            print(f"           {len(entry.order_ids)} order(s): "
                  f"{', '.join(entry.order_ids)}")
        print()
        print(f"  total: {_vnd(sum(e.amount for e in ready))}")

    if blocked:
        print()
        print(f"WAITING ON AN ACCOUNT NUMBER  ({len(blocked)} customer(s))")
        print()
        for entry in blocked:
            print(f"  {entry.customer_id:<8} {entry.display_name or '-':<20}"
                  f" {_vnd(entry.amount):>14}   owed, no bank details yet")

    if pipeline["pipeline"]:
        rows = pipeline["pipeline"]
        print()
        print(f"AWAITING SHOPEE  ({len(rows)} order(s) -- NOT payable, "
              f"figures are estimates)")
        print()
        for row in rows:
            # The snapshot has already applied the rate; applying it
            # again here is how the console and the CLI end up quoting
            # the same order differently.
            print(f"  {row['customer_id']:<8} "
                  f"{(row['product'] or row['order_id'])[:30]:<30}"
                  f" {_vnd(row['cashback']):>12}")
        print()
        print(f"  estimated total to customers: "
              f"{_vnd(pipeline['totals']['pipeline'])}")

    if args.qr:
        return _write_qr_page(ready, blocked)
    return 0


def _write_qr_page(ready, waiting) -> int:
    """One page of scannable transfers, opened in a browser and paid off."""
    from pathlib import Path

    from ...ledger import payouts

    if not ready:
        print()
        print("No QR page written: nobody is owed anything right now.")
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


def cmd_dashboard(cfg: Config, args: argparse.Namespace) -> int:
    """Serve the end-of-day payout page on loopback."""
    import webbrowser

    from ...web import dashboard

    port = args.port or cfg.dashboard_port
    if args.open:
        # Opened after a moment so the server is listening by the time the
        # browser asks for the page.
        import threading
        threading.Timer(
            1.0, lambda: webbrowser.open(f"http://127.0.0.1:{port}")
        ).start()

    dashboard.serve(cfg, port=port)
    return 0


def cmd_merge_customers(cfg: Config, args: argparse.Namespace) -> int:
    """Fold duplicate customers left by the Zalo account change.

    Shows the plan unless --apply is given. Applying snapshots the ledger
    first and runs as one transaction: it all lands or none of it does.
    """
    from ...ledger import backup, merge

    # The plan is read-only. Codes are issued by `serve` AFTER merging, so
    # a merged-away row never takes a number.
    skip = {name.strip() for name in args.skip}

    def describe(row) -> str:
        with ledger.connect(cfg.db_path) as conn:
            counts = {t: conn.execute(
                f"SELECT COUNT(*) FROM {t} WHERE customer_id=?",
                (row["customer_id"],)).fetchone()[0]
                for t in ("link_requests", "orders")}
        extras = [label for label, present in (
            ("bank", row["bank_account"]), ("password", row["password_hash"]))
            if present]
        return (f"{row['customer_id']:<20} {row['created_at'][:16]}  "
                f"links={counts['link_requests']} orders={counts['orders']} "
                + " ".join(extras))

    with ledger.connect(cfg.db_path) as conn:
        pairs = [p for p in merge.find_pairs(conn) if p.name not in skip]

    blocked = [p for p in pairs if p.conflict]
    for p in pairs:
        mark = f"  !! {p.conflict}" if p.conflict else ""
        print(f"{p.name}{mark}")
        print(f"   old {describe(p.old)}")
        print(f"   new {describe(p.new)}")
    print()
    print(f"{len(pairs)} pair(s), {len(blocked)} need a decision"
          + (f", skipped: {', '.join(sorted(skip))}" if skip else ""))
    for customer_id in args.delete:
        print(f"delete {customer_id}")

    if not args.apply:
        print("\nNothing changed. Re-run with --apply to merge.")
        return 0
    if blocked:
        print("\nRefusing: resolve or --skip the pairs marked !! first.")
        return 1

    snapshot = backup.create(cfg.db_path, cfg.backup_dir, keep=cfg.backup_keep)
    print(f"\nBackup: {snapshot}")
    ledger.initialise(cfg.db_path, assign_codes=False)
    with ledger.connect(cfg.db_path) as conn:
        for p in merge.find_pairs(conn):
            if p.name in skip:
                continue
            merge.merge(conn, p)
        outcomes = {cid: merge.delete_unused(conn, cid) for cid in args.delete}
        refused = {cid: why for cid, why in outcomes.items() if why != "deleted"}
        if refused:
            raise SystemExit(f"Rolled back, nothing changed: {refused}")
    print(f"Merged {len(pairs)} pair(s); deleted {len(args.delete)} row(s).")
    return 0


def cmd_backfill_products(cfg: Config, args: argparse.Namespace) -> int:
    """Find the picture and name for link requests saved without them.

    Opens short links and asks third-party sources, spaced out, so it
    shows what it found first and writes only with --apply.
    """
    from ...shopee import product_backfill

    with ledger.connect(cfg.db_path) as conn:
        results = product_backfill.run(
            conn, apply=args.apply, only_ordered=not args.all)
    for r in results:
        found = f"{r.source:<22} item={r.item_id or '-':<13}"
        print(f"{r.request_id:<16} {found} {(r.name or '')[:40]}")
    filled = sum(1 for r in results if r.image_url)
    print()
    print(f"{filled} of {len(results)} request(s) have a picture now"
          + ("" if args.apply else " (nothing written; re-run with --apply)"))
    return 0


def cmd_campaign_create(cfg: Config, args: argparse.Namespace) -> int:
    """Register a promotion. Shows it first; writes only with --apply."""
    from ...ledger import campaigns

    ledger.initialise(cfg.db_path)  # the campaign tables arrive by migration

    excluded = []
    with ledger.connect(cfg.db_path) as conn:
        for key in args.exclude:
            found = ledger.find_customer_id(conn, key)
            if found is None:
                print(f"Unknown customer to exclude: {key}")
                return 1
            excluded.append(found)
    print(f"{args.id}: {args.name}")
    print(f"  window  {args.starts} -> {args.ends}")
    print(f"  slots   {args.slots} x {args.bonus:,} VND, min order {args.min_order:,} VND")
    print(f"  on      {args.platforms}")
    print(f"  per customer {args.per_customer or 'no limit'}")
    print(f"  exclude {', '.join(excluded) or '-'}")
    if not args.apply:
        print("Nothing written. Re-run with --apply.")
        return 0
    with ledger.connect(cfg.db_path) as conn:
        campaigns.create(conn, args.id, args.name, args.starts, args.ends,
                         args.slots, args.bonus, min_order_value=args.min_order,
                         platforms=args.platforms,
                         excluded_customers=",".join(excluded),
                         per_customer=args.per_customer)
    print("Created.")
    return 0


def cmd_announce(cfg: Config, args: argparse.Namespace) -> int:
    """Post an announcement to the test or main group. Shows it first;
    sends only with --send. Rehearse in "test" before "main"."""
    from pathlib import Path

    from ...messaging.assistant_bridge import AssistantError, AssistantSender

    text = Path(args.text).read_text(encoding="utf-8").strip()
    image = str(Path(args.image).resolve()) if args.image else None
    if image and not Path(image).is_file():
        print(f"No such picture: {image}")
        return 1
    print(f"To group : {args.group}")
    print(f"Picture  : {image or '-'}")
    print(f"Tag all  : {'yes' if '@All' in text else 'no'}")
    print("-" * 60)
    print(text)
    print("-" * 60)
    if not args.send:
        print("Nothing sent. Re-run with --send.")
        return 0
    try:
        AssistantSender(cfg.assistant_url, cfg.assistant_token, timeout=90).broadcast(
            text, group=args.group, image_path=image, mention_all="@All" in text)
    except AssistantError as exc:
        print(f"Not sent: {exc}")
        return 1
    print("Sent.")
    return 0


def cmd_campaign_status(cfg: Config, args: argparse.Namespace) -> int:
    """Who holds which slot right now. Settles the slots first."""
    from ...ledger import campaigns

    ledger.initialise(cfg.db_path)  # the campaign tables arrive by migration

    with ledger.connect(cfg.db_path) as conn:
        campaigns.evaluate(conn)
        for campaign in conn.execute("SELECT * FROM campaigns ORDER BY starts_at"):
            awards = conn.execute(
                "SELECT a.id, a.order_id, a.status, a.amount, c.customer_code,"
                "       c.display_name, o.recorded_at, o.status AS order_status"
                "  FROM campaign_awards a"
                "  JOIN customers c ON c.customer_id = a.customer_id"
                "  JOIN orders o ON o.order_id = a.order_id"
                " WHERE a.campaign_id=? ORDER BY a.id", (campaign["campaign_id"],)).fetchall()
            live = [a for a in awards if a["status"] != campaigns.VOID]
            print(f"{campaign['campaign_id']} [{campaign['status']}] {campaign['name']}"
                  f"  {len(live)}/{campaign['slots']} slots"
                  f"  {campaign['starts_at']} -> {campaign['ends_at']}")
            for a in sorted(live, key=lambda r: (ledger._created_sort_key(r["recorded_at"]), r["id"])):
                print(f"  #{campaigns._rank(conn, campaign['campaign_id'], a['id']):<3}"
                      f" {a['customer_code'] or '-':<8} {(a['display_name'] or '')[:22]:<22}"
                      f" order {a['order_id']:<16} {a['order_status']:<18} bonus {a['status']}")
            for a in awards:
                if a["status"] == campaigns.VOID:
                    print(f"  void {a['customer_code'] or '-':<8} order {a['order_id']} (cancelled)")
    return 0


def cmd_backup(cfg: Config, args: argparse.Namespace) -> int:
    """Snapshot the ledger, safe to run while the bot is writing."""
    from ...ledger import backup

    dest = backup.create(cfg.db_path, cfg.backup_dir, keep=cfg.backup_keep)
    print(f"Backup written: {dest} ({dest.stat().st_size:,} bytes)")
    print(f"Keeping the newest {cfg.backup_keep} in {cfg.backup_dir}")
    return 0
