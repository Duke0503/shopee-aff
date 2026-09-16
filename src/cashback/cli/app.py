"""Operator command line: argument parsing and dispatch.

The command bodies live in `commands/`, grouped by what they touch. This
module only decides which one runs, so adding a command means editing one
command module and one line of the table below -- not scrolling through
nine hundred lines to find where a function ended.
"""

from __future__ import annotations

import argparse
import sys

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
    p.add_argument("--port", type=int, default=8899)
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
    p.add_argument("--dashboard-port", type=int, default=8899)
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

        "check-policy": analysis.cmd_check_policy,
        "metrics": analysis.cmd_metrics,
        "audit": analysis.cmd_audit,

        "inspect-report": reports.cmd_inspect_report,
        "reconcile": reports.cmd_reconcile,

        "bridge": browser.cmd_bridge,
        "setup-token": browser.cmd_setup_token,
        "probe": browser.cmd_probe,

        "run": service.cmd_run,
        "zalo-check": service.cmd_zalo_check,
        "serve": service.cmd_serve,
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




CUSTOM_LINK_URL = "https://affiliate.shopee.vn/offer/custom_link"


















# Customer-facing wording lives in the message file, never in code:
# written here it had to go without diacritics and reached customers
# as "30-70 ngay".
