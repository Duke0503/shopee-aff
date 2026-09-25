"""Operator command line: argument parsing and dispatch.

The command bodies live in `commands/`, grouped by what they touch. This
module only decides which one runs, so adding a command means editing one
command module and one line of the table below -- not scrolling through
nine hundred lines to find where a function ended.
"""

from __future__ import annotations

import argparse
import sys

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    try:
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from ..core.config import Config, load
from ..core.logging_setup import configure as configure_logging
from ..core.policy import WITHHOLDING_THRESHOLD_VND, TaxPolicy
from .commands import analysis, browser, ledger_ops, reports, service
from .formatting import _vnd


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

    p = sub.add_parser("payouts",
                       help="who is owed money, grouped by customer")
    p.add_argument("--qr", action="store_true",
                   help="also write payouts.html with a VietQR per customer")

    p = sub.add_parser("dashboard",
                       help="open the end-of-day payout page in a browser")
    p.add_argument("--port", type=int, default=None,
                   help="default: DASHBOARD_PORT")
    p.add_argument("--open", action="store_true",
                   help="also open it in the default browser")

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

    sub.add_parser("backup", help="snapshot the ledger (safe while serving)")

    p = sub.add_parser("campaign-create", help="register a bonus promotion")
    p.add_argument("--id", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--starts", required=True, help="ISO time, e.g. 2026-09-26T00:00:00+07:00")
    p.add_argument("--ends", required=True, help="ISO time, exclusive")
    p.add_argument("--slots", type=int, required=True)
    p.add_argument("--bonus", type=int, required=True, help="VND per slot")
    p.add_argument("--min-order", type=int, default=0)
    p.add_argument("--platforms", default="shopee,shopeefood,tiktok")
    p.add_argument("--per-customer", type=int, default=0,
                   help="most slots one customer may hold (0 = no limit)")
    p.add_argument("--exclude", action="append", default=[], metavar="CUSTOMER",
                   help="DP code, UID or id that never holds a slot (repeatable)")
    p.add_argument("--apply", action="store_true")

    sub.add_parser("campaign-status", help="who holds which campaign slot")

    p = sub.add_parser("announce", help="post an announcement to a group via the assistant")
    p.add_argument("--text", required=True, help="file holding the message")
    p.add_argument("--image", help="picture sent before the message")
    p.add_argument("--group", choices=("test", "main"), default="test")
    p.add_argument("--send", action="store_true", help="send it (default: only show it)")

    p = sub.add_parser(
        "backfill-products",
        help="find pictures and names for links saved without them")
    p.add_argument("--apply", action="store_true",
                   help="write what was found (default: only show it)")
    p.add_argument("--all", action="store_true",
                   help="every link request, not only those with an order")

    p = sub.add_parser(
        "merge-customers",
        help="fold duplicate customers left by a Zalo account change")
    p.add_argument("--apply", action="store_true",
                   help="write the changes (default: only show the plan)")
    p.add_argument("--skip", action="append", default=[], metavar="NAME",
                   help="leave the pair with this display name alone")
    p.add_argument("--delete", action="append", default=[], metavar="ID",
                   help="remove a row with no history (a bot, a stale copy)")

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
        "serve", help="run everything: links, notifications, payout page"
    )
    p.add_argument("--port", type=int, default=None)
    p.add_argument("--window", type=int, default=None, help="batch window seconds")
    p.add_argument("--max-size", type=int, default=None)
    p.add_argument("--connect-timeout", type=int, default=45)
    p.add_argument(
        "--no-browser", action="store_true",
        help="Zalo side only; queue links but do not generate them"
    )
    p.add_argument(
        "--no-reconcile", action="store_true",
        help="do not pull the conversion report on a timer"
    )
    p.add_argument("--dashboard-port", type=int, default=None,
                   help="default: DASHBOARD_PORT")
    p.add_argument(
        "--no-dashboard", action="store_true",
        help="do not serve the payout page"
    )

    p = sub.add_parser(
        "inspect-report",
        help="print the columns in a downloaded conversion report and guess a mapping",
    )
    p.add_argument("file")

    p = sub.add_parser(
        "review",
        help="rows reconciliation would not guess at, and how to clear them",
    )
    p.add_argument(
        "--retry", action="store_true",
        help="re-apply parked rows through the current mapping",
    )
    p.add_argument(
        "--resolve", type=int, metavar="ID",
        help="mark one row as dealt with by hand; the ledger is not changed",
    )

    p = sub.add_parser(
        "reconcile", help="apply a conversion report to the ledger"
    )
    p.add_argument("file", nargs="?",
                   help="a CSV exported from the dashboard; omit with --live")
    p.add_argument(
        "--live", action="store_true",
        help="read the report from the dashboard instead of a file",
    )
    p.add_argument("--days", type=int, default=60,
                   help="how far back --live reads")
    p.add_argument("--port", type=int, default=None)
    p.add_argument(
        "--withheld",
        action="store_true",
        help="this payout period was withheld at 10%%",
    )
    p.add_argument(
        "--dry-run", action="store_true", help="parse and show, change nothing"
    )

    p = sub.add_parser(
        "sync-accesstrade",
        help="synchronize TikTok Shop orders from AccessTrade API",
    )
    p.add_argument(
        "--days", type=int, default=30,
        help="number of days to look back for orders (default 30)",
    )

    return parser


# --- report import ----------------------------------------------------








def _handlers() -> dict:
    """Command name to the function that runs it.

    Kept as data rather than a chain of ifs so the parser and the table
    can be compared at a glance when one of them is missing an entry.
    """
    return {
        "init": ledger_ops.cmd_init,
        "status": ledger_ops.cmd_status,
        "payouts": ledger_ops.cmd_payouts,
        "dashboard": ledger_ops.cmd_dashboard,
        "pay": ledger_ops.cmd_pay,
        "expire": ledger_ops.cmd_expire,
        "links": ledger_ops.cmd_links,
        "add-customer": ledger_ops.cmd_add_customer,
        "request": ledger_ops.cmd_request,
        "forget": ledger_ops.cmd_forget,
        "reset": ledger_ops.cmd_reset,
        "backup": ledger_ops.cmd_backup,
        "campaign-create": ledger_ops.cmd_campaign_create,
        "campaign-status": ledger_ops.cmd_campaign_status,
        "announce": ledger_ops.cmd_announce,
        "backfill-products": ledger_ops.cmd_backfill_products,
        "merge-customers": ledger_ops.cmd_merge_customers,

        "check-policy": analysis.cmd_check_policy,
        "metrics": analysis.cmd_metrics,
        "audit": analysis.cmd_audit,

        "inspect-report": reports.cmd_inspect_report,
        "reconcile": reports.cmd_reconcile,
        "review": reports.cmd_review,
        "sync-accesstrade": reports.cmd_sync_accesstrade,

        "bridge": browser.cmd_bridge,
        "setup-token": browser.cmd_setup_token,
        "probe": browser.cmd_probe,

        "run": service.cmd_run,
        "serve": service.cmd_serve,
    }


def main(argv: list[str] | None = None) -> int:
    if sys.stdout and hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if sys.stderr and hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    args = build_parser().parse_args(argv)
    # Logging is set up before any command runs, so a failure during a
    # long-running one leaves a file behind rather than only scrollback.
    # `serve` is the one that matters: it runs for days unattended.
    configure_logging(console=args.command == "serve")
    return _handlers()[args.command](load(), args)


if __name__ == "__main__":
    sys.exit(main())




CUSTOM_LINK_URL = "https://affiliate.shopee.vn/offer/custom_link"


















# Customer-facing wording lives in the message file, never in code:
# written here it had to go without diacritics and reached customers
# as "30-70 ngay".
