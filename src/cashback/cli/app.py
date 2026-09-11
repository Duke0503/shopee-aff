"""Command line interface."""

from __future__ import annotations

import argparse
import sys

from ..ledger import repository as ledger
from ..messaging import templates as messages
from ..ledger import metrics
from ..core.config import Config, load
from ..core.logging_setup import configure as configure_logging
from ..core.policy import (
    WITHHOLDING_THRESHOLD_VND,
    TaxPolicy,
    policy_warnings,
    split_commission,
)


def _vnd(amount: int | None) -> str:
    return "-" if amount is None else f"{amount:,} VND"


def _pct(value: float | None) -> str:
    return "-" if value is None else f"{value:.2%}"


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


def cmd_check_policy(cfg: Config, args: argparse.Namespace) -> int:
    """Show what each tax policy means in money, before going live."""
    monthly = args.monthly_commission
    sample = args.sample_commission

    print(f"Sample order, approved commission {_vnd(sample)}\n")
    header = f"{'policy':<16}{'customer gets':>18}{'share':>9}{'you keep':>14}{'share':>9}"
    print(header)
    print("-" * len(header))
    for policy in TaxPolicy:
        split = split_commission(
            sample, cfg.cashback_rate, policy, period_is_withheld=True
        )
        print(
            f"{policy.value:<16}{split.customer_receives:>14,} VND"
            f"{split.customer_share:>9.1%}"
            f"{split.operator_keeps:>10,} VND{split.operator_share:>9.2%}"
        )

    print(f"\nAssuming {_vnd(monthly)} of commission per month")
    print(f"(withholding threshold is {_vnd(WITHHOLDING_THRESHOLD_VND)} per payout)\n")

    warnings = policy_warnings(cfg.tax_policy, cfg.cashback_rate, monthly)
    if not warnings:
        print(f"Policy '{cfg.tax_policy.value}': nothing to flag.")
        print(f"Advertise {cfg.cashback_rate:.0%} -- customers receive exactly that.")
        return 0

    print(f"WARNINGS for policy '{cfg.tax_policy.value}':")
    for line in warnings:
        print(f"  ! {line}")
    return 0


def cmd_metrics(cfg: Config, args: argparse.Namespace) -> int:
    with ledger.connect(cfg.db_path) as conn:
        m = metrics.compute(conn)

    print(f"Confidence: {m.confidence}\n")
    print("The three that matter")
    print(f"  effective commission rate : {_pct(m.effective_commission_rate)}")
    print(f"  valid rate                : {_pct(m.valid_rate)}")
    print(f"  approved AOV              : {_vnd(m.approved_aov)}")
    print("\nCounts")
    print(f"  orders total / approved / rejected / awaiting : "
          f"{m.total_orders} / {m.approved_orders} / {m.rejected_orders} / "
          f"{m.awaiting_orders}")
    print(f"  link requests             : {m.total_link_requests}"
          f"  (converted {_pct(m.link_conversion_rate)})")
    print(f"  pending manual review     : {m.pending_manual_review}")
    print("\nMoney")
    print(f"  approved GMV              : {_vnd(m.approved_gmv)}")
    print(f"  approved commission       : {_vnd(m.approved_commission)}")
    print(f"  paid to customers         : {_vnd(m.paid_to_customers)}")
    print(f"  owed to customers         : {_vnd(m.owed_to_customers)}")

    earnings = metrics.estimate_earnings(
        m, cfg.cashback_rate, cfg.tax_policy, period_is_withheld=args.withheld
    )
    if not earnings.get("no_data"):
        print("\nOperator take (before operating costs)")
        print(f"  service fee               : {_vnd(earnings['service_fee'])}")
        print(f"  withheld tax              : {_vnd(earnings['withheld_tax'])}")
        print(f"  customer receives         : {_vnd(earnings['customer_receives'])}")
        print(f"  you keep                  : "
              f"{_vnd(earnings['operator_keeps_before_costs'])}"
              f"  ({earnings['operator_share']:.2%})")
        print(f"  NOTE: {earnings['caveat']}")

    if not m.has_enough_data:
        print(
            f"\nFewer than {metrics.MIN_ORDERS_TO_TRUST} approved orders. "
            "These rates are not yet meaningful -- do not plan around them."
        )
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


def cmd_audit(cfg: Config, args: argparse.Namespace) -> int:
    """Read the trail: one customer's history, or the whole-list scan."""
    from ..core import audit
    from ..ledger import suspicion

    if args.archive:
        done = audit.archive_closed_months()
        if not done:
            print("Nothing to archive: only the current month is open.")
            return 0
        for path in done:
            print(f"  archived {path.name}  ({path.stat().st_size:,} bytes)")
        return 0

    if args.customer:
        events = suspicion.history(args.customer, months=args.months)
        if not events:
            print(f"No recorded activity for {args.customer}.")
            return 0
        print(f"{len(events)} event(s) for {args.customer}")
        print()
        for event in events:
            extra = {k: v for k, v in event.items()
                     if k not in ("at", "event", "customer_id")}
            detail = "  ".join(f"{k}={v}" for k, v in extra.items())
            print(f"  {event['at']}  {event['event']:<18} {detail}")
        return 0

    if args.scan:
        with ledger.connect(cfg.db_path) as conn:
            findings = suspicion.scan(conn, months=args.months)
        if not findings:
            print("Nothing flagged.")
            return 0
        print(f"{len(findings)} finding(s), most serious first.")
        print("None of these prove anything -- they are shapes worth a look.")
        print()
        for f in findings:
            print(f"  [{f.severity.upper():<6}] {f.customer_id}  {f.pattern}")
            print(f"           {f.summary}")
            for line in f.evidence:
                print(f"           - {line}")
            print()
        return 0

    print("Pick one: --customer <id>, --scan, or --archive")
    return 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cashback", description="Shopee affiliate cashback ledger"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init", help="create the ledger database")
    sub.add_parser("status", help="show configuration and mode")

    p = sub.add_parser("check-policy", help="what each tax policy means in money")
    p.add_argument("--monthly-commission", type=int, default=9_000_000)
    p.add_argument("--sample-commission", type=int, default=27_000)

    p = sub.add_parser("metrics", help="the three figures that matter")
    p.add_argument(
        "--withheld",
        action="store_true",
        help="assume the payout period was withheld at 10%%",
    )

    sub.add_parser("payouts", help="orders approved and awaiting transfer")

    p = sub.add_parser("pay", help="mark an order as transferred")
    p.add_argument("order_id")
    p.add_argument("--note", default="")

    sub.add_parser("expire", help="expire link requests past the attribution window")

    p = sub.add_parser("audit", help="trace customer activity and flag odd accounts")
    p.add_argument("--customer", help="show everything one customer did")
    p.add_argument("--scan", action="store_true",
                   help="list accounts worth a second look before paying")
    p.add_argument("--archive", action="store_true",
                   help="compress closed months to save disk")
    p.add_argument("--months", type=int, default=3)

    p = sub.add_parser(
        "bridge", help="serve the local bridge for the browser helper extension"
    )
    p.add_argument("--port", type=int, default=None)
    p.add_argument("--window", type=int, default=None, help="batch window seconds")
    p.add_argument("--max-size", type=int, default=None)

    sub.add_parser(
        "setup-token",
        help="generate the bridge secret and write it to .env and the extension",
    )

    p = sub.add_parser(
        "probe", help="dump a dashboard page structure through the extension"
    )
    p.add_argument(
        "--url", default="https://affiliate.shopee.vn/offer/custom_link"
    )
    p.add_argument("--port", type=int, default=None)
    p.add_argument("--wait", type=int, default=3000, help="ms to let the page settle")
    p.add_argument("--connect-timeout", type=int, default=30)
    p.add_argument("--save", default="probe.json", help="write the raw dump here")

    p = sub.add_parser("add-customer", help="register a customer")
    p.add_argument("--id", default=None, help="omit to allocate the next one")
    p.add_argument("--name", default="")
    p.add_argument("--zalo-id", default="")
    p.add_argument("--chat-id", default="", help="private chat id, needed to notify")
    p.add_argument("--bank", default="")
    p.add_argument("--account", default="")
    p.add_argument("--holder", default="")

    p = sub.add_parser("request", help="queue a link request for a customer")
    p.add_argument("customer_id")
    p.add_argument("url")
    p.add_argument("--channel", default="direct")
    p.add_argument("--force", action="store_true", help="queue even if not ready")

    p = sub.add_parser(
        "forget", help="erase a customer and all their data"
    )
    p.add_argument("who", help="customer id, Zalo id, or part of their name")
    p.add_argument(
        "--force", action="store_true",
        help="erase even if a payout is still owed"
    )

    p = sub.add_parser("reset", help="wipe the whole ledger (testing only)")
    p.add_argument("--yes", action="store_true")

    p = sub.add_parser("links", help="recent link requests")
    p.add_argument("--limit", type=int, default=20)

    p = sub.add_parser("run", help="run the worker: queue -> browser -> ledger")
    p.add_argument("--port", type=int, default=None)
    p.add_argument("--window", type=int, default=None, help="batch window seconds")
    p.add_argument("--max-size", type=int, default=None)
    p.add_argument("--connect-timeout", type=int, default=45)

    p = sub.add_parser(
        "zalo-check",
        help="verify the Zalo token and dump raw updates to learn their shape",
    )
    p.add_argument(
        "--seconds", type=int, default=0,
        help="0 (default) listens until Ctrl+C"
    )

    p = sub.add_parser(
        "serve", help="run everything: Zalo bot plus link generation"
    )
    p.add_argument("--port", type=int, default=None)
    p.add_argument("--window", type=int, default=None, help="batch window seconds")
    p.add_argument("--max-size", type=int, default=None)
    p.add_argument("--connect-timeout", type=int, default=45)
    p.add_argument(
        "--no-browser", action="store_true",
        help="Zalo side only; queue links but do not generate them"
    )

    p = sub.add_parser(
        "inspect-report",
        help="print the columns in a downloaded conversion report and guess a mapping",
    )
    p.add_argument("file")

    p = sub.add_parser(
        "reconcile", help="apply a downloaded conversion report to the ledger"
    )
    p.add_argument("file")
    p.add_argument(
        "--withheld",
        action="store_true",
        help="this payout period was withheld at 10%%",
    )
    p.add_argument(
        "--dry-run", action="store_true", help="parse and show, change nothing"
    )
    return parser


# --- report import ----------------------------------------------------

def cmd_inspect_report(cfg: Config, args: argparse.Namespace) -> int:
    """Print the headers found in a downloaded report, plus a guessed mapping."""
    from pathlib import Path

    from ..shopee.report_importer import MAPPING_FILE, ColumnMapping, detect_mapping, read_headers

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

    from ..shopee import reconciliation as reconcile
    from ..shopee.report_importer import MAPPING_FILE, ColumnMapping, read_rows

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



def cmd_bridge(cfg: Config, args: argparse.Namespace) -> int:
    from ..shopee.browser_bridge import Bridge, serve

    if not cfg.bridge_token:
        print("BRIDGE_TOKEN is empty. Set a long random value in .env first,")
        print("and the same value in extension/background/base_url.js.")
        print("Without it any local process could drive the extension.")
        return 1

    bridge = Bridge(
        token=cfg.bridge_token,
        hosts=["affiliate.shopee.vn"],
        landing_url="https://affiliate.shopee.vn/offer/custom_link",
    )
    serve(bridge, args.port or cfg.bridge_port)
    return 0


def _handlers() -> dict:
    """Built lazily so command functions may be defined in any order."""
    return {
        "init": cmd_init,
        "status": cmd_status,
        "check-policy": cmd_check_policy,
        "metrics": cmd_metrics,
        "payouts": cmd_payouts,
        "pay": cmd_pay,
        "expire": cmd_expire,
        "audit": cmd_audit,
        "inspect-report": cmd_inspect_report,
        "reconcile": cmd_reconcile,
        "bridge": cmd_bridge,
        "setup-token": cmd_setup_token,
        "probe": cmd_probe,
        "add-customer": cmd_add_customer,
        "request": cmd_request,
        "links": cmd_links,
        "run": cmd_run,
        "zalo-check": cmd_zalo_check,
        "serve": cmd_serve,
        "forget": cmd_forget,
        "reset": cmd_reset,
    }


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    # Logging is set up before any command runs, so a failure during a
    # long-running one leaves a file behind rather than only scrollback.
    # `serve` is the one that matters: it runs for days unattended.
    configure_logging(console=args.command == "serve")
    return _handlers()[args.command](load(), args)


if __name__ == "__main__":
    sys.exit(main())


def cmd_setup_token(cfg: Config, args: argparse.Namespace) -> int:
    """Generate a bridge secret and write it to both places that need it.

    The bridge and the extension must agree on this value. Writing it by hand
    in two files invites a silent mismatch, which surfaces only as every
    request returning 401.
    """
    import re
    import secrets
    from pathlib import Path

    from ..core.config import PROJECT_ROOT

    token = secrets.token_urlsafe(48)

    env_path = PROJECT_ROOT / ".env"
    if not env_path.exists():
        print(f"{env_path} not found. Copy .env.example to .env first.")
        return 1

    env_text = env_path.read_text(encoding="utf-8")
    if re.search(r"^BRIDGE_TOKEN=.*$", env_text, flags=re.MULTILINE):
        env_text = re.sub(
            r"^BRIDGE_TOKEN=.*$", f"BRIDGE_TOKEN={token}", env_text,
            flags=re.MULTILINE,
        )
    else:
        env_text = env_text.rstrip("\n") + f"\nBRIDGE_TOKEN={token}\n"
    env_path.write_text(env_text, encoding="utf-8")

    js_path = PROJECT_ROOT / "extension" / "background" / "base_url.js"
    example = js_path.with_name("base_url.example.js")
    if not js_path.exists():
        if not example.exists():
            print(f"Neither {js_path} nor {example} exists.")
            return 1
        js_path.write_text(example.read_text(encoding="utf-8"), encoding="utf-8")
        print(f"Created {js_path.name} from the example.")

    js_text = js_path.read_text(encoding="utf-8")
    js_text, count = re.subn(
        r"^export const bridge_token = .*$",
        f"export const bridge_token = '{token}';",
        js_text,
        flags=re.MULTILINE,
    )
    if not count:
        print(f"No bridge_token line found in {js_path}. Left unchanged.")
        return 1
    js_path.write_text(js_text, encoding="utf-8")

    print("New bridge secret written to:")
    print(f"  {env_path}")
    print(f"  {js_path}")
    print("\nReload the extension in chrome://extensions for it to pick this up.")
    return 0


CUSTOM_LINK_URL = "https://affiliate.shopee.vn/offer/custom_link"


def cmd_probe(cfg: Config, args: argparse.Namespace) -> int:
    """Dump the structure of a dashboard page, so a script can be written."""
    import json as _json
    from pathlib import Path

    from ..shopee import page_prober as probe
    from ..shopee.browser_bridge import Bridge, serve_in_background

    if not cfg.bridge_token:
        print("BRIDGE_TOKEN is empty. Run: cashback setup-token")
        return 1

    bridge = Bridge(
        token=cfg.bridge_token,
        hosts=["affiliate.shopee.vn"],
        landing_url=CUSTOM_LINK_URL,
    )
    server = serve_in_background(bridge, args.port or cfg.bridge_port)
    print(f"Bridge up on 127.0.0.1:{args.port or cfg.bridge_port}. "
          "Waiting for the extension...")

    import time

    for _ in range(int(args.connect_timeout)):
        if bridge.connected():
            break
        time.sleep(1)
    else:
        server.shutdown()
        print("\nExtension never checked in. Things to verify:")
        print("  - loaded at chrome://extensions (Developer mode, Load unpacked)")
        print("  - Chrome is open")
        print("  - token matches: cashback setup-token, then Reload the extension")
        return 1

    print("Extension connected. Probing...\n")
    try:
        found = probe.run(bridge, args.url, wait_ms=args.wait)
    except RuntimeError as exc:
        print(f"Probe failed: {exc}")
        return 1
    finally:
        server.shutdown()

    # Save before printing. A console that cannot render the page's own
    # language must not cost us the dump we just spent 30 seconds collecting.
    if args.save:
        out = Path(args.save)
        out.write_text(_json.dumps(found, indent=2, ensure_ascii=False),
                       encoding="utf-8")
        print(f"Raw dump written to {out}\n")

    _print_safely(probe.report(found))
    return 0


def _print_safely(text: str) -> None:
    """Print text a legacy console may not be able to encode.

    Windows consoles often default to a codepage that cannot represent the
    page's own language. Losing the report to a UnicodeEncodeError would be
    absurd, so fall back to replacing what the console cannot draw.
    """
    try:
        print(text)
    except UnicodeEncodeError:
        encoding = sys.stdout.encoding or "ascii"
        sys.stdout.buffer.write(text.encode(encoding, errors="replace"))
        sys.stdout.buffer.write(b"\n")
        sys.stdout.flush()
        print(
            "\n(Some characters could not be drawn by this console. "
            "The saved JSON has them intact.)"
        )


def _bridge_for(cfg: Config):
    from ..shopee.browser_bridge import Bridge
    from ..shopee.page_selectors import CUSTOM_LINK_URL

    return Bridge(
        token=cfg.bridge_token,
        hosts=["affiliate.shopee.vn"],
        landing_url=CUSTOM_LINK_URL,
    )


def cmd_add_customer(cfg: Config, args: argparse.Namespace) -> int:
    from ..ledger import repository as ledger
    from ..core.identifiers import next_customer_id

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
    from ..ledger import repository as ledger
    from ..core.identifiers import new_request_id

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


def cmd_links(cfg: Config, args: argparse.Namespace) -> int:
    from ..ledger import repository as ledger

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


def cmd_run(cfg: Config, args: argparse.Namespace) -> int:
    from ..worker import runner as worker
    from ..shopee.browser_bridge import serve_in_background
    from ..worker.batch_queue import BatchSettings

    if not cfg.bridge_token:
        print("BRIDGE_TOKEN is empty. Run: cashback setup-token")
        return 1

    bridge = _bridge_for(cfg)
    server = serve_in_background(bridge, args.port or cfg.bridge_port)
    print(f"Bridge up on 127.0.0.1:{args.port or cfg.bridge_port}. "
          "Waiting for the extension...")

    # A late extension is not a reason to take the whole bot down. After a
    # restart it can take a poll cycle to notice the bridge is back, and
    # quitting here kills the Zalo side too -- customers stop being answered
    # over something that fixes itself in thirty seconds. The link loop
    # re-checks the connection on every pass and picks it up on its own.
    if worker.wait_for_extension(bridge, args.connect_timeout):
        print("Extension connected.\n")
    else:
        print("\nExtension has not checked in yet. Carrying on without it:")
        print("  - Zalo replies work now")
        print("  - links start generating as soon as it appears")
        print("If it stays away: load it at chrome://extensions, open")
        print("affiliate.shopee.vn, or re-sync with: cashback setup-token\n")
    settings = BatchSettings(
        window_seconds=args.window or cfg.batch_window_seconds,
        max_size=args.max_size or cfg.batch_max_size,
    )
    try:
        worker.loop(cfg.db_path, bridge, settings, cfg.link_attribution_days)
    finally:
        server.shutdown()
    return 0


def cmd_zalo_check(cfg: Config, args: argparse.Namespace) -> int:
    """Confirm the token works and reveal what updates actually look like.

    Three things are undocumented and matter: the value of chat.type for a
    group, whether a group message reaches the bot without an @mention, and
    how that mention appears inside the text. Rather than guessing, this
    prints raw updates so they can be read off.
    """
    import json as _json
    import time

    from ..messaging.zalo_client import ZaloBot, ZaloError

    if not cfg.zalo_bot_token:
        print("ZALO_BOT_TOKEN is empty in .env")
        print("\nTo get one: open Zalo, find the 'Zalo Bot Manager' official")
        print("account, choose 'Create bot'. The name must start with 'Bot'.")
        print("The token arrives as a Zalo message.")
        return 1

    try:
        with ZaloBot(cfg.zalo_bot_token, cfg.zalo_api_url) as bot:
            me = bot.get_me()
            print("Token works. Bot identity:")
            print(_json.dumps(me, indent=2, ensure_ascii=False))

            forever = args.seconds <= 0
            window = "until Ctrl+C" if forever else f"for {args.seconds}s"
            print(f"\nListening {window}. Now, in Zalo:")
            print("  1. message the bot privately")
            print("  2. add it to a group and send a message WITHOUT tagging it")
            print("  3. send another message, this time tagging it\n")

            deadline = time.time() + (args.seconds if not forever else 0)
            seen = 0
            while forever or time.time() < deadline:
                remaining = 25 if forever else max(5, int(deadline - time.time()))
                try:
                    updates = bot.get_updates(timeout=min(25, remaining))
                except ZaloError as exc:
                    print(f"  getUpdates failed: {exc}")
                    time.sleep(2)
                    continue
                for update in updates:
                    seen += 1
                    msg = update.message
                    where = "?" 
                    if msg:
                        where = "GROUP" if msg.chat.is_group else "private"
                    print(f"--- update {seen}  ({where}) ---")
                    print(_json.dumps(update.raw, indent=2, ensure_ascii=False))
                    if msg:
                        print(f"  chat.id   = {msg.chat.id}")
                        print(f"  chat.type = {msg.chat.type!r}"
                              f"   <- is this the group marker?")
                        print(f"  text      = {msg.text!r}")
                        print(f"  sender    = {msg.sender_id} {msg.sender_name!r}")
                if not updates:
                    print(f"  ...{int(deadline - time.time())}s left, nothing yet")

            if not seen:
                print("No updates arrived. Either nothing was sent, or a webhook")
                print("is registered -- getUpdates and webhooks are mutually")
                print("exclusive. Check with getWebhookInfo.")
                return 1
            print(f"\n{seen} update(s) captured.")
    except ZaloError as exc:
        print(f"Failed: {exc}")
        return 1
    return 0


# Customer-facing wording lives in the message file, never in code:
# written here it had to go without diacritics and reached customers
# as "30-70 ngay".
PAYOUT_WINDOW_TEXT = messages.render("payout_window")


def cmd_serve(cfg: Config, args: argparse.Namespace) -> int:
    """Run everything: listen on Zalo, generate links, reply.

    Two loops share one ledger. The Zalo loop only touches the database;
    the link loop only touches the browser. Neither blocks the other, so a
    slow browser pass never stops the bot from answering.
    """
    import threading
    import time

    from ..worker import runner as worker
    from ..messaging import conversation as zalo_handler
    from ..shopee.browser_bridge import serve_in_background
    from ..worker.batch_queue import BatchSettings
    from ..messaging.zalo_client import ZaloBot, ZaloError

    if not cfg.zalo_bot_token:
        print("ZALO_BOT_TOKEN is empty. Run: cashback zalo-check")
        return 1
    if not cfg.bridge_token:
        print("BRIDGE_TOKEN is empty. Run: cashback setup-token")
        return 1

    # Apply any schema added since this database was created. Cheap and
    # idempotent -- and skipping it once already had the bot querying a
    # column that did not exist yet, which killed every delivery.
    ledger.initialise(cfg.db_path)

    stop = threading.Event()
    bridge = _bridge_for(cfg)
    server = serve_in_background(bridge, args.port or cfg.bridge_port)
    print(f"Bridge up on 127.0.0.1:{args.port or cfg.bridge_port}.")

    if not args.no_browser:
        print("Waiting for the extension...")
        if not worker.wait_for_extension(bridge, args.connect_timeout):
            server.shutdown()
            print("\nExtension never checked in. Load it at chrome://extensions,")
            print("open affiliate.shopee.vn, then try again.")
            print("(Use --no-browser to run the Zalo side alone.)")
            return 1
        print("Extension connected.")

    settings = BatchSettings(
        window_seconds=args.window or cfg.batch_window_seconds,
        max_size=args.max_size or cfg.batch_max_size,
    )

    def zalo_loop() -> None:
        with ZaloBot(cfg.zalo_bot_token, cfg.zalo_api_url) as bot:
            me = bot.get_me()
            print(f"Zalo bot: {me.get('display_name')} "
                  f"(groups: {me.get('can_join_groups')})")
            while not stop.is_set():
                try:
                    updates = bot.get_updates(timeout=20)
                except ZaloError as exc:
                    print(f"[zalo] {exc}")
                    time.sleep(5)
                    continue

                for update in updates:
                    msg = update.message
                    if not msg:
                        continue
                    where = "group" if msg.chat.is_group else "private"
                    print(f"[zalo] {where} from {msg.sender_name or msg.sender_id}: "
                          f"{(msg.text or '')[:60]!r}")
                    try:
                        replies = zalo_handler.handle(
                            cfg.db_path, msg, cfg.advertised_cashback_rate,
                            PAYOUT_WINDOW_TEXT, update.event_name,
                        )
                        zalo_handler.send_replies(bot, replies)
                    except Exception as exc:
                        print(f"[zalo] handler error: {exc}")

                try:
                    sent = zalo_handler.deliver_ready_links(
                        cfg.db_path, bot, cfg.advertised_cashback_rate,
                        PAYOUT_WINDOW_TEXT, bridge=bridge,
                        third_party=cfg.third_party_fallback,
                    )
                    if sent:
                        print(f"[zalo] delivered {sent} link(s) to customers")
                    zalo_handler.notify_order_changes(
                        cfg.db_path, bot, cfg.advertised_cashback_rate,
                        PAYOUT_WINDOW_TEXT,
                    )
                    zalo_handler.notify_failed_links(cfg.db_path, bot)
                except Exception as exc:
                    print(f"[zalo] delivery error: {exc}")

    def link_loop() -> None:
        totals = worker.Totals()
        while not stop.is_set():
            if bridge.connected():
                try:
                    worker.run_one_pass(cfg.db_path, bridge, settings, totals)
                except Exception as exc:
                    print(f"[links] pass error: {exc}")
            time.sleep(5)

    threads = [threading.Thread(target=zalo_loop, daemon=True)]
    if not args.no_browser:
        threads.append(threading.Thread(target=link_loop, daemon=True))
    for t in threads:
        t.start()

    print("\nRunning. Ctrl+C to stop.\n")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nStopping...")
    finally:
        stop.set()
        server.shutdown()
    return 0


def cmd_forget(cfg: Config, args: argparse.Namespace) -> int:
    """Erase a customer completely. Matches on id, name or Zalo id."""
    from ..ledger import repository as ledger

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
    from ..ledger import repository as ledger

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
