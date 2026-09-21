"""The payout console: JSON for the browser, and the two actions on it.

This module used to render HTML from Python. It now serves data, and
serves the built React app, and knows nothing about how either looks.
The split matters for a reason beyond tidiness: a customer-facing view
is coming, and it has to read the same ledger through the same code.
Two views over one set of dicts is fine; two views over two hand-written
HTML builders is how they start disagreeing about what someone is owed.

WHAT IS AND IS NOT PAYABLE
--------------------------
Everything approved and unpaid is payable, grouped by customer. There is
no minimum -- see ledger.payouts for why the old 50,000 VND one went.
Orders Shopee has not settled are listed separately and never counted as
owed; those figures are estimates twice over and every view says so.

The two actions are not conveniences. One sends a real message to a real
person, the other records that money left the account. Both refuse an id
that is not plainly alphanumeric, and mark_paid refuses an order that
already has a paid_at, so a double click cannot pay twice.

TWO AUDIENCES, TWO SETS OF ROUTES
---------------------------------
/api/payouts and the two actions are the OPERATOR's. They carry bank
account numbers and other people's balances, and they refuse any request
that did not arrive on loopback -- so putting the customer page on a real
domain later cannot expose them by accident.

/api/auth/* and /api/me are the CUSTOMER's. They need a session, and they
read through `my_orders`, which has no code path to anyone else's row.
See core/accounts.py for why the bot is the login channel.
"""

from __future__ import annotations

import json
import math
import mimetypes
import random
import re
import socket
import threading
import urllib.parse
from datetime import datetime, timezone, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from ..core import accounts
from ..core.config import PROJECT_ROOT, Config
from ..core.policy import round_dong
from ..ledger import payouts
from ..ledger import repository as ledger

LABELS_FILE = Path("resources") / "dashboard.vi.json"
STATIC_DIR = Path(__file__).resolve().parent / "static"

# Ids this system issues are alphanumeric. Anything else arriving on an
# action route is not a typo, it is an attempt.
SAFE_ID = re.compile(r"^[A-Za-z0-9]+$")

def labels() -> dict[str, str]:
    raw = json.loads((PROJECT_ROOT / LABELS_FILE).read_text(encoding="utf-8"))
    return {k: v for k, v in raw.items() if not k.startswith("_")}


def site_figures(cfg: Config) -> dict:
    """The handful of numbers the public pages quote.

    The worked example comes from the same two constants the bot uses in
    its greeting. A percentage is not a figure anyone converts into money
    in their head, so both places show one -- and showing two different
    ones would be worse than showing none.
    """
    from ..messaging.conversation import EXAMPLE_ORDER_VND, EXAMPLE_RATE

    rate = cfg.advertised_cashback_rate
    return {
        "rate": f"{rate:.0%}",
        "reduced": f"{cfg.reduced_cashback_rate:.0%}",
        "days": _payout_window(),
        "example_order": _vnd(EXAMPLE_ORDER_VND),
        "example_commission": f"{EXAMPLE_RATE:.0%}",
        "example_cashback": _vnd(round_dong(
            EXAMPLE_ORDER_VND * EXAMPLE_RATE * rate)),
    }


def _vnd(amount: int) -> str:
    """Money as the labels spell it, so the page and the bot agree."""
    grouped = f"{round(amount):,}".replace(",", t("thousands_separator"))
    return grouped + t("currency")


def _payout_window() -> str:
    """How long Shopee takes, in the same words the bot uses."""
    from ..messaging import templates as messages

    return messages.render("payout_window")


def t(key: str, **values) -> str:
    """One label, with {placeholders} filled in."""
    text = labels().get(key, key)
    for name, value in values.items():
        text = text.replace("{" + name + "}", str(value))
    return text


# ----------------------------------------------------------------------
# Reading
# ----------------------------------------------------------------------

def _orders_of(conn, customer_id: str) -> list[dict]:
    """The approved, unpaid orders behind one customer's balance.

    Each carries the link it came from, so the operator can open the
    affiliate URL and check the order against Shopee before paying.
    """
    rows = conn.execute(
        "SELECT o.order_id, o.order_value, o.approved_commission,"
        "       o.cashback_amount, o.approved_at,"
        "       r.source_url, r.affiliate_url, r.estimate_detail"
        "  FROM orders o"
        "  LEFT JOIN link_requests r ON r.request_id = o.request_id"
        " WHERE o.customer_id = ? AND o.status = 'approved' AND o.paid_at IS NULL"
        " ORDER BY o.approved_at",
        (customer_id,),
    ).fetchall()
    out = []
    for row in rows:
        item = dict(row)
        item["product"] = _product_name(item.pop("estimate_detail", None))
        out.append(item)
    return out


def _pipeline(conn, rate: float) -> list[dict]:
    """Orders Shopee has recorded but not yet settled.

    Nothing here is payable, and every view must say so. But a console
    showing only what is payable is blank on most days, which reads as
    "nothing is happening" when several orders are in flight.
    """
    rows = conn.execute(
        "SELECT o.order_id, o.customer_id, o.order_value,"
        "       o.estimated_commission, o.recorded_at,"
        "       c.display_name, r.affiliate_url, r.source_url, r.estimate_detail"
        "  FROM orders o"
        "  LEFT JOIN customers c ON c.customer_id = o.customer_id"
        "  LEFT JOIN link_requests r ON r.request_id = o.request_id"
        " WHERE o.status = 'awaiting_approval'"
        " ORDER BY o.recorded_at DESC"
    ).fetchall()
    out = []
    for row in rows:
        item = dict(row)
        item["product"] = _product_name(item.pop("estimate_detail", None))
        est_comm = item.get("estimated_commission") or 0
        net_comm = round_dong(est_comm * (1 - 0.10 - 0.0098))
        item["cashback"] = round_dong(net_comm * rate)
        out.append(item)
    return out


def _product_name(detail: str | None) -> str:
    if not detail:
        return ""
    from ..shopee.commission import Estimate

    estimate = Estimate.from_json(detail)
    return estimate.name if estimate else ""


def _calculate_order_financials(
    comm: int | None,
    estimate_raw: str | None,
    cashback_amount: int | None,
    status: str,
    advertised_rate: float,
) -> dict:
    gross = comm or 0
    service_fee = round_dong(gross * 0.0098)
    tax_amount = round_dong(gross * 0.10)
    net_shopee = gross - service_fee - tax_amount

    detail = {}
    if estimate_raw:
        try:
            detail = json.loads(estimate_raw)
        except Exception:
            detail = {}

    shopee_rate = float(detail.get("shopee_rate") or 0.0)
    seller_rate = float(detail.get("seller_rate") or 0.0)

    shopee_part = 0
    seller_part = 0
    if "shopee_part" in detail and "seller_part" in detail:
        est_comm = detail.get("commission") or (detail.get("shopee_part", 0) + detail.get("seller_part", 0))
        if est_comm > 0:
            ratio = detail.get("shopee_part", 0) / est_comm
            shopee_part = round_dong(gross * ratio)
            seller_part = gross - shopee_part
        else:
            shopee_part = round_dong(gross * 0.4)
            seller_part = gross - shopee_part
    elif "shopee_rate" in detail and "seller_rate" in detail:
        tot_rate = (detail.get("shopee_rate") or 0) + (detail.get("seller_rate") or 0)
        if tot_rate > 0:
            ratio = (detail.get("shopee_rate") or 0) / tot_rate
            shopee_part = round_dong(gross * ratio)
            seller_part = gross - shopee_part
        else:
            shopee_part = round_dong(gross * 0.4)
            seller_part = gross - shopee_part
    else:
        shopee_part = round_dong(gross * 0.4)
        seller_part = gross - shopee_part

    if cashback_amount is None:
        cb = round_dong(net_shopee * advertised_rate) if status != "rejected" else 0
    else:
        cb = cashback_amount

    admin_profit = (net_shopee - cb) if status != "rejected" else 0
    admin_margin = round((admin_profit / net_shopee) * 100, 1) if net_shopee > 0 else 20.0

    return {
        "gross_commission": gross,
        "shopee_rate": shopee_rate,
        "seller_rate": seller_rate,
        "shopee_part": shopee_part,
        "seller_part": seller_part,
        "service_fee": service_fee,
        "tax_amount": tax_amount,
        "net_shopee": net_shopee,
        "cashback_amount": cb,
        "admin_profit": admin_profit,
        "admin_margin": admin_margin,
    }


def _payable_json(entry, orders: list[dict]) -> dict:
    return {
        "customer_id": entry.customer_id,
        "display_name": entry.display_name,
        "amount": entry.amount,
        "bank_name": entry.bank_name,
        "bank_account": entry.bank_account,
        "account_holder": entry.account_holder,
        "has_bank": entry.has_bank_details,
        "reference": entry.reference,
        # None when the written bank name matched no bank, or more than
        # one. The view then shows the raw details and says to transfer
        # by hand; a guess here sends money to a stranger.
        "qr_url": entry.qr_url(),
        "order_ids": list(entry.order_ids),
        "orders": orders,
    }


def snapshot(db_path: Path, rate: float = 0.80) -> dict:
    """Everything either view needs, in one read, as plain JSON."""
    with ledger.connect(db_path) as conn:
        owed = payouts.collect(conn)
        detail = {p.customer_id: _orders_of(conn, p.customer_id) for p in owed}
        pipeline = _pipeline(conn, rate)

    ready, blocked = payouts.split_by_bank_details(owed)
    pipeline_total_cashback = sum(r["cashback"] for r in pipeline)
    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "rate": rate,
        "ready": [_payable_json(p, detail[p.customer_id]) for p in ready],
        "no_bank": [_payable_json(p, detail[p.customer_id]) for p in blocked],
        "pipeline": pipeline,
        "totals": {
            "owed": sum(p.amount for p in owed),
            "owed_customers": len(owed),
            "ready": sum(p.amount for p in ready),
            "no_bank": sum(p.amount for p in blocked),
            "pipeline": pipeline_total_cashback,
            "pipeline_orders": len(pipeline),
        },
    }


# ----------------------------------------------------------------------
# One customer's own view
# ----------------------------------------------------------------------

def my_orders(db_path: Path, customer_id: str, rate: float) -> dict:
    """What one customer can see: their orders and nothing else.

    Deliberately a separate read from `snapshot`. The operator view
    carries bank account numbers and other people's balances, and the
    cheapest way to never leak those is for the customer endpoint to
    have no code path that can reach them.
    """
    with ledger.connect(db_path) as conn:
        customer = ledger.get_customer(conn, customer_id)
        balance = payouts.balance_for(conn, customer_id, rate)
        rows = conn.execute(
            "SELECT o.order_id, o.status, o.order_value,"
            "       o.estimated_commission, o.approved_commission,"
            "       o.cashback_amount, o.recorded_at, o.approved_at,"
            "       o.paid_at, o.rejection_reason,"
            "       r.affiliate_url, r.source_url, r.estimate_detail"
            "  FROM orders o"
            "  LEFT JOIN link_requests r ON r.request_id = o.request_id"
            " WHERE o.customer_id = ?"
            " ORDER BY COALESCE(o.recorded_at, o.approved_at) DESC",
            (customer_id,),
        ).fetchall()

    orders = []
    for row in rows:
        item = dict(row)
        item["product"] = _product_name(item.pop("estimate_detail", None))
        # An awaiting order has no settled figure, so show the estimate
        # of the customer's share and let the view label it as one.
        if item["cashback_amount"] is None:
            est_comm = item.get("estimated_commission") or 0
            net_comm = round_dong(est_comm * (1 - 0.10 - 0.0098))
            item["cashback"] = round_dong(net_comm * rate)
            item["is_estimate"] = True
        else:
            item["cashback"] = item["cashback_amount"]
            item["is_estimate"] = False
        orders.append(item)

    role = (customer["role"] if customer and "role" in customer.keys() else "user") or "user"
    return {
        "customer_id": customer_id,
        "display_name": (customer["display_name"] if customer else "") or "",
        "role": role,
        "is_admin": role == "admin",
        "is_employee": role == "employee",
        "is_staff": role in ("admin", "employee"),
        "last_login_at": customer["last_login_at"] if customer and "last_login_at" in customer.keys() else None,
        "login_count": customer["login_count"] if customer and "login_count" in customer.keys() else 0,
        # Enough to recognise the account, never enough to reconstruct it.
        "bank_name": (customer["bank_name"] if customer else "") or "",
        "bank_account_tail": _tail(
            customer["bank_account"] if customer else ""),
        "account_holder": (customer["account_holder"] if customer else "") or "",
        "has_bank": bool(customer and customer["bank_account"] and customer["bank_name"]),
        "rate": rate,
        "balance": {
            "approved": balance.approved,
            "awaiting": balance.awaiting,
            "paid": balance.paid,
            "approved_orders": balance.approved_orders,
            "awaiting_orders": balance.awaiting_orders,
        },
        "orders": orders,
    }


def _tail(account: str) -> str:
    """Last four digits. The customer confirms it; nobody else can use it."""
    account = (account or "").strip()
    return f"***{account[-4:]}" if len(account) >= 4 else ""


# ----------------------------------------------------------------------
# Actions
# ----------------------------------------------------------------------

def ask_for_bank(cfg: Config, customer_id: str) -> dict:
    """Have the bot ask this customer for their account, privately.

    Only reachable for someone who already has approved money waiting,
    which is the only moment the question is reasonable.
    """
    from ..messaging import templates as messages
    from ..messaging.zalo_client import ZaloBot, ZaloError

    if not SAFE_ID.match(customer_id or ""):
        return {"ok": False, "message": t("ask_failed", reason="bad id")}

    with ledger.connect(cfg.db_path) as conn:
        row = ledger.get_customer(conn, customer_id)
    if row is None or not row["private_chat_id"]:
        return {"ok": False, "message": t("ask_failed", reason="no private chat")}

    try:
        with ZaloBot(cfg.zalo_bot_token, cfg.zalo_api_url) as bot:
            bot.send(row["private_chat_id"], messages.render("need_bank"))
    except (ZaloError, Exception) as exc:
        return {"ok": False, "message": t("ask_failed", reason=str(exc)[:120])}

    return {"ok": True,
            "message": t("ask_sent", name=row["display_name"] or customer_id)}


def mark_paid(cfg: Config, customer_id: str, order_ids: list[str]) -> dict:
    """Record a transfer that already happened in the banking app.

    Every order in the balance is marked together, because the operator
    made one transfer for the lot. mark_paid refuses anything already
    paid, so a double click cannot pay twice.
    """
    if not SAFE_ID.match(customer_id or ""):
        return {"ok": False, "message": t("paid_failed", reason="bad id")}

    done = 0
    with ledger.connect(cfg.db_path) as conn:
        row = ledger.get_customer(conn, customer_id)
        for order_id in order_ids:
            if not SAFE_ID.match(order_id):
                continue
            if ledger.mark_paid(conn, order_id, note="dashboard"):
                done += 1
    if not done:
        return {"ok": False, "message": t("paid_failed", reason="nothing to mark")}
    name = (row["display_name"] if row else "") or customer_id
    return {"ok": True, "message": t("paid_done", name=name)}


# ----------------------------------------------------------------------
# Serving
# ----------------------------------------------------------------------

SESSION_COOKIE = "cashback_session"

# The operator routes never leave this machine. Checked per request
# rather than trusted to the bind address, because the bind address is
# one config change away from being wrong.
LOOPBACK = {"127.0.0.1", "::1", "localhost", "::ffff:127.0.0.1"}


def _cookies(header: str | None) -> dict[str, str]:
    jar = {}
    for part in (header or "").split(";"):
        name, _, value = part.strip().partition("=")
        if name:
            jar[name] = value
    return jar


_MISSING_BUILD = (
    "<!doctype html><meta charset=utf-8><title>Giao dien chua build</title>"
    "<body style=\"font:15px/1.6 system-ui;padding:40px;max-width:640px\">"
    "<h1 style=\"font-size:19px\">Giao dien chua duoc build</h1>"
    "<p>Chay mot lan:</p>"
    "<pre style=\"background:#f1f2f4;padding:12px;border-radius:8px\">"
    "cd web\nnpm install\nnpm run build</pre>"
    "<p>API van chay: <a href=\"/api/payouts\">/api/payouts</a></p>"
)


class _Handler(BaseHTTPRequestHandler):
    cfg: Config

    def log_message(self, fmt, *args):
        return

    def setup(self):
        super().setup()
        self._extra_headers: list[tuple[str, str]] = []
        self._head_only: bool = False

    def _send(self, status: int, body: bytes, content_type: str):
        headers_to_send = list(getattr(self, "_extra_headers", []))
        self._extra_headers = []
        try:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            for name, value in headers_to_send:
                self.send_header(name, value)
            self.end_headers()
            if not getattr(self, "_head_only", False):
                self.wfile.write(body)
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            pass

    def do_HEAD(self):
        self._head_only = True
        try:
            self.do_GET()
        finally:
            self._head_only = False

    def _json(self, payload: dict, status: int = 200):
        self._send(status,
                   json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                   "application/json; charset=utf-8")

    # -- helpers --------------------------------------------------------
    @property
    def from_loopback(self) -> bool:
        # A request arriving from the public internet through Cloudflare
        # carries CF-Connecting-IP and CF-Ray headers added by Cloudflare Edge.
        if self.headers.get("CF-Connecting-IP") or self.headers.get("CF-Ray"):
            return False
        addr = (self.client_address[0] or "").lower()
        if addr.startswith("::ffff:"):
            addr = addr[7:]
        return addr in LOOPBACK or (self.client_address[0] or "") in LOOPBACK

    def _session_customer_info(self) -> tuple[str | None, dict | None]:
        token = _cookies(self.headers.get("Cookie")).get(SESSION_COOKIE, "")
        if not token:
            return None, None
        with ledger.connect(self.cfg.db_path) as conn:
            customer_id = accounts.customer_for_token(conn, token)
            if not customer_id:
                conn.commit()
                return None, None
            cust = ledger.get_customer(conn, customer_id)
            conn.commit()
            return customer_id, dict(cust) if cust else None

    def _session_is_staff(self) -> bool:
        _, cust = self._session_customer_info()
        return bool(cust and cust.get("role") in ("admin", "employee"))

    def _session_is_admin(self) -> bool:
        _, cust = self._session_customer_info()
        return bool(cust and cust.get("role") == "admin")

    def _session_customer(self) -> str | None:
        customer_id, _ = self._session_customer_info()
        return customer_id

    def _set_session(self, token: str, clear: bool = False):
        parts = [
            f"{SESSION_COOKIE}={token}",
            "Path=/",
            "HttpOnly",
            "SameSite=Strict",
            "Max-Age=0" if clear else f"Max-Age={accounts.SESSION_DAYS * 86400}",
        ]
        # Set Secure flag when accessed over HTTPS (direct or through Cloudflare edge)
        proto = self.headers.get("X-Forwarded-Proto") or ""
        cf_visitor = self.headers.get("CF-Visitor") or ""
        if proto.lower() == "https" or '"https"' in cf_visitor:
            parts.append("Secure")
        self._extra_headers = [("Set-Cookie", "; ".join(parts))]

    # -- GET ------------------------------------------------------------
    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path

        if path == "/api/payouts":
            if not self.from_loopback and not self._session_is_staff():
                return self._json({"ok": False, "message": "forbidden"}, 403)
            return self._json(
                snapshot(self.cfg.db_path, self.cfg.advertised_cashback_rate))
        if path == "/api/admin/metrics":
            return self._admin_metrics()
        if path.startswith("/api/admin/users/"):
            subparts = path.strip("/").split("/")
            if len(subparts) == 4:
                return self._admin_user_detail(urllib.parse.unquote(subparts[3]))
        if path == "/api/admin/users":
            return self._admin_users()
        if path == "/api/admin/employees":
            return self._admin_employees()
        if path == "/api/admin/orders":
            return self._admin_orders()
        if path == "/api/admin/products":
            return self._admin_products()
        if path == "/api/admin/logs":
            return self._admin_logs()
        if path == "/api/labels":
            return self._json(labels())
        if path == "/api/site":
            # Public: the figures the landing page quotes. Policy rather
            # than wording, so not in the labels file -- and deliberately
            # not read from /api/payouts, which never leaves loopback.
            return self._json(site_figures(self.cfg))
        if path == "/api/shopee/link-status":
            return self._shopee_link_status()
        if path == "/api/shopee/cache/stats":
            return self._shopee_cache_stats()
        if path == "/api/me":
            customer_id = self._session_customer()
            if customer_id is None:
                return self._json({"ok": False, "message": "not_signed_in"}, 401)
            return self._json(my_orders(
                self.cfg.db_path, customer_id,
                self.cfg.advertised_cashback_rate))
        if path.startswith("/api/"):
            return self._json({"ok": False, "message": "unknown endpoint"}, 404)

        return self._serve_static(path)

    def _serve_static(self, path: str):
        """The built app, with unknown paths falling back to index.

        A single-page app owns its own routing, so a deep link has to
        return index.html rather than 404.
        """
        index = STATIC_DIR / "index.html"
        if not index.exists():
            return self._send(200, _MISSING_BUILD.encode("utf-8"),
                              "text/html; charset=utf-8")

        target = index
        if path not in ("/", "", "/index.html"):
            # Resolve inside STATIC_DIR or not at all. A path that climbs
            # out with .. is how a local server serves the rest of the disk.
            candidate = (STATIC_DIR / path.lstrip("/")).resolve()
            try:
                candidate.relative_to(STATIC_DIR.resolve())
            except ValueError:
                candidate = index
            if candidate.is_file():
                target = candidate

        kind = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if kind.startswith("text/") or kind == "application/javascript":
            kind += "; charset=utf-8"

        # Caching & Security headers
        headers: list[tuple[str, str]] = []
        if "/assets/" in path and target.suffix in (".js", ".css"):
            headers.append(("Cache-Control", "public, max-age=31536000, immutable"))
        elif target.suffix in (".webp", ".ico", ".png", ".jpg", ".svg"):
            headers.append(("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800"))
        elif target == index:
            headers.append(("Cache-Control", "no-cache, must-revalidate"))
        else:
            headers.append(("Cache-Control", "public, max-age=3600"))

        headers.append(("X-Content-Type-Options", "nosniff"))
        self._extra_headers = headers
        self._send(200, target.read_bytes(), kind)

    # -- POST -----------------------------------------------------------
    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        parts = path.strip("/").split("/")

        if path == "/api/auth/login":
            return self._login()
        if path == "/api/auth/logout":
            return self._logout()
        if path == "/api/admin/login":
            return self._admin_login()
        if path == "/api/admin/logout":
            return self._logout()
        if path == "/api/admin/employees":
            return self._admin_create_employee()
        if path == "/api/admin/employees/update":
            return self._admin_update_employee()
        if path == "/api/admin/orders/mark-paid":
            return self._admin_mark_paid()
        if path == "/api/admin/transfers":
            return self._admin_record_transfer()
        if path == "/api/auth/password":
            return self._change_password()
        if path == "/api/me/bank":
            return self._update_bank()
        if path == "/api/me/bank/erase":
            return self._erase_bank()
        if path == "/api/shopee/preview":
            return self._shopee_preview()
        if path == "/api/shopee/convert":
            return self._shopee_convert()
        if path == "/api/shopee/smart-resolve":
            return self._shopee_smart_resolve()
        if path == "/api/shopee/cache/refresh-hot":
            if not self.from_loopback and not self._session_is_staff():
                return self._json({"ok": False, "message": "forbidden"}, 403)
            return self._shopee_cache_refresh_hot()
        if path == "/api/activity/log":
            if not self.from_loopback and not self._session_is_staff():
                return self._json({"ok": False, "message": "forbidden"}, 403)
            return self._record_activity_log()

        # /api/customers/<id>/paid  and  /api/customers/<id>/ask-bank
        if len(parts) == 4 and parts[:2] == ["api", "customers"]:
            if not self.from_loopback and not self._session_is_staff():
                return self._json({"ok": False, "message": "forbidden"}, 403)
            customer_id, action = parts[2], parts[3]
            if action == "ask-bank":
                return self._json(ask_for_bank(self.cfg, customer_id))
            if action == "paid":
                ids = self._body().get("order_ids")
                if not isinstance(ids, list):
                    return self._json({"ok": False, "message": "bad body"}, 400)
                return self._json(
                    mark_paid(self.cfg, customer_id, [str(i) for i in ids]))
        return self._json({"ok": False, "message": "unknown action"}, 404)

    # -- auth routes ----------------------------------------------------
    def _login(self):
        from ..core import audit

        body = self._body()
        with ledger.connect(self.cfg.db_path) as conn:
            result = accounts.login(conn, str(body.get("name") or ""),
                                    str(body.get("password") or ""))
            conn.commit()
        if not result.ok:
            # Failures are audited but never told apart for the caller:
            # distinguishing "no such account" from "wrong password" turns
            # the form into a way to ask who uses this service.
            audit.record(audit.LOGIN_REFUSED,
                         name=str(body.get("name") or "")[:40],
                         reason=result.reason)
            return self._json({"ok": False, "message": result.reason}, 401)
        audit.record(audit.LOGIN_OK, customer_id=result.customer_id)
        self._set_session(result.token)
        return self._json({"ok": True, "customer_id": result.customer_id})

    def _logout(self):
        token = _cookies(self.headers.get("Cookie")).get(SESSION_COOKIE, "")
        if token:
            with ledger.connect(self.cfg.db_path) as conn:
                accounts.logout(conn, token)
                conn.commit()
        self._set_session("", clear=True)
        return self._json({"ok": True, "message": "ok"})

    def _change_password(self):
        customer_id = self._session_customer()
        if customer_id is None:
            return self._json({"ok": False, "message": "not_signed_in"}, 401)
        body = self._body()
        with ledger.connect(self.cfg.db_path) as conn:
            ok, reason = accounts.change_password(
                conn, customer_id, str(body.get("current") or ""),
                str(body.get("replacement") or ""))
            conn.commit()
        return self._json({"ok": ok, "message": reason}, 200 if ok else 400)

    def _update_bank(self):
        from ..core import audit

        body = self._body()
        customer_id = self._session_customer()
        if customer_id is None:
            return self._json({"ok": False, "message": "not_signed_in"}, 401)
        bank_name = str(body.get("bank_name") or "").strip()[:60]
        bank_account = str(body.get("bank_account") or "").strip()[:35]
        account_holder = str(body.get("account_holder") or "").strip().upper()[:80]

        clean_account = re.sub(r"[\s\-]", "", bank_account)

        if not bank_name:
            return self._json({"ok": False, "message": "missing_bank_name"}, 400)
        if not (4 <= len(clean_account) <= 30 and clean_account.isalnum()):
            return self._json({"ok": False, "message": "invalid_bank_account"}, 400)
        if len(account_holder) < 2:
            return self._json({"ok": False, "message": "missing_account_holder"}, 400)

        with ledger.connect(self.cfg.db_path) as conn:
            ledger.set_bank_details(
                conn, customer_id, bank_name, clean_account, account_holder
            )
            audit.record(
                audit.BANK_CHANGED,
                customer_id=customer_id,
                bank=bank_name,
                account=audit.fingerprint(clean_account),
                source="web",
            )
            conn.commit()
        return self._json({
            "ok": True,
            "bank_name": bank_name,
            "bank_account_tail": _tail(clean_account),
            "account_holder": account_holder,
            "has_bank": True,
        })

    def _erase_bank(self):
        from ..core import audit

        customer_id = self._session_customer()
        if customer_id is None:
            return self._json({"ok": False, "message": "not_signed_in"}, 401)
        with ledger.connect(self.cfg.db_path) as conn:
            ledger.erase_bank_details(conn, customer_id)
            audit.record(audit.BANK_ERASED, customer_id=customer_id, source="web")
            conn.commit()
        return self._json({"ok": True, "message": "ok"})

    # -- Admin & Staff Handlers -----------------------------------------
    def _admin_login(self):
        from ..core import audit

        body = self._body()
        name = str(body.get("name") or body.get("username") or "")
        password = str(body.get("password") or "")
        with ledger.connect(self.cfg.db_path) as conn:
            result = accounts.login(conn, name, password)
            if not result.ok:
                conn.commit()
                audit.record(audit.LOGIN_REFUSED, name=name[:40], reason=result.reason)
                return self._json({"ok": False, "message": "Tài khoản hoặc mật khẩu không chính xác."}, 401)

            cust_row = ledger.get_customer(conn, result.customer_id)
            cust = dict(cust_row) if cust_row else {}
            conn.commit()

        role = cust.get("role") or "user"
        if role not in ("admin", "employee"):
            self._set_session("", clear=True)
            return self._json({
                "ok": False,
                "message": "Tài khoản của bạn không có quyền truy cập khu vực quản trị."
            }, 403)

        audit.record(audit.LOGIN_OK, customer_id=result.customer_id)
        self._set_session(result.token)
        return self._json({
            "ok": True,
            "customer_id": result.customer_id,
            "display_name": cust.get("display_name") or result.customer_id,
            "role": role,
            "is_admin": role == "admin",
            "is_employee": role == "employee",
        })

    def _admin_metrics(self):
        cust_id, cust = self._session_customer_info()
        if not cust or cust.get("role") not in ("admin", "employee"):
            return self._json({"ok": False, "message": "unauthorized"}, 403)

        is_admin = cust.get("role") == "admin"
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        period = qs.get("period", ["all"])[0]

        date_filter = "1=1"
        if period == "today":
            date_filter = "date(COALESCE(recorded_at, approved_at)) = date('now')"
        elif period == "7d":
            date_filter = "COALESCE(recorded_at, approved_at) >= datetime('now', '-7 days')"
        elif period == "30d":
            date_filter = "COALESCE(recorded_at, approved_at) >= datetime('now', '-30 days')"
        elif period == "month":
            date_filter = "strftime('%Y-%m', COALESCE(recorded_at, approved_at)) = strftime('%Y-%m', 'now')"

        with ledger.connect(self.cfg.db_path) as conn:
            total_users = conn.execute("SELECT COUNT(*) FROM customers WHERE role = 'user'").fetchone()[0]
            total_employees = conn.execute("SELECT COUNT(*) FROM customers WHERE role IN ('admin', 'employee')").fetchone()[0]
            try:
                active_24h = conn.execute(
                    "SELECT COUNT(*) FROM customers WHERE role = 'user' AND last_login_at >= datetime('now', '-1 day')"
                ).fetchone()[0]
            except Exception:
                active_24h = 0

            # Orders in period
            orders_count = conn.execute(f"SELECT COUNT(*) FROM orders WHERE {date_filter}").fetchone()[0]
            approved_count = conn.execute(f"SELECT COUNT(*) FROM orders WHERE {date_filter} AND status = 'approved'").fetchone()[0]
            paid_count = conn.execute(f"SELECT COUNT(*) FROM orders WHERE {date_filter} AND status = 'paid'").fetchone()[0]
            awaiting_count = conn.execute(f"SELECT COUNT(*) FROM orders WHERE {date_filter} AND status = 'awaiting_approval'").fetchone()[0]
            rejected_count = conn.execute(f"SELECT COUNT(*) FROM orders WHERE {date_filter} AND status = 'rejected'").fetchone()[0]

            total_gmv = conn.execute(
                f"SELECT COALESCE(SUM(order_value), 0) FROM orders WHERE {date_filter}"
            ).fetchone()[0]

            gross_commission = conn.execute(
                f"SELECT COALESCE(SUM(COALESCE(approved_commission, estimated_commission, 0)), 0) FROM orders WHERE {date_filter} AND status != 'rejected'"
            ).fetchone()[0]

            cashback_paid = conn.execute(
                f"SELECT COALESCE(SUM(COALESCE(cashback_amount, 0)), 0) FROM orders WHERE {date_filter} AND status = 'paid'"
            ).fetchone()[0]

            cashback_ready = conn.execute(
                f"SELECT COALESCE(SUM(COALESCE(cashback_amount, 0)), 0) FROM orders WHERE {date_filter} AND status = 'approved' AND paid_at IS NULL"
            ).fetchone()[0]

            pipeline_gross = conn.execute(
                f"SELECT COALESCE(SUM(COALESCE(estimated_commission, 0)), 0) FROM orders WHERE {date_filter} AND status = 'awaiting_approval'"
            ).fetchone()[0]
            pipeline_fee = round_dong(pipeline_gross * 0.0098)
            pipeline_tax = round_dong(pipeline_gross * 0.10)
            pipeline_net = pipeline_gross - pipeline_fee - pipeline_tax
            cashback_pipeline = round_dong(pipeline_net * self.cfg.advertised_cashback_rate)

            cached_products = 0
            try:
                cached_products = conn.execute("SELECT COUNT(*) FROM products_cache").fetchone()[0]
            except Exception:
                pass

            total_logs = 0
            try:
                total_logs = conn.execute("SELECT COUNT(*) FROM activity_logs").fetchone()[0]
            except Exception:
                pass

            # Calculated KPIs
            aov = round_dong(total_gmv / orders_count) if orders_count > 0 else 0
            avg_commission = round_dong(gross_commission / orders_count) if orders_count > 0 else 0
            settled_count = approved_count + paid_count + rejected_count
            approval_rate = round(((approved_count + paid_count) / settled_count) * 100, 1) if settled_count > 0 else 100.0

            # Phân tách rõ ràng tiền hoàn khách (80% của THỰC NHẬN từ Shopee):
            # 1. cashback_paid: Số tiền đã hoàn (thực tế đã chuyển khoản)
            # 2. cashback_ready: Số tiền chờ chi trả (đơn đã duyệt, chờ chuyển khoản)
            # 3. cashback_pipeline: Số tiền dự tính sẽ hoàn (đơn đang chờ duyệt: 80% thực nhận)
            # 4. total_cashback_all: Tổng tiền hoàn tất cả (đã hoàn + chờ hoàn + dự tính)
            total_cashback_all = cashback_paid + cashback_ready + cashback_pipeline
            total_cashback_committed = cashback_paid + cashback_ready
            
            # Shopee deductions:
            # - Phí dịch vụ sàn Shopee: 0.98%
            # - Thuế TNCN khấu trừ tại nguồn: 10%
            shopee_fee = round_dong(gross_commission * 0.0098)
            tax_withheld = round_dong(gross_commission * 0.10)
            net_from_shopee = round_dong(gross_commission - shopee_fee - tax_withheld)

            # Lợi nhuận dự tính: Thực nhận Shopee trừ đi TOÀN BỘ tiền sẽ chia cho khách (đã hoàn + chờ hoàn + dự tính)
            estimated_net_profit = round_dong(net_from_shopee - total_cashback_all)
            estimated_net_margin = round((estimated_net_profit / net_from_shopee) * 100, 1) if net_from_shopee > 0 else 20.0

            # Lợi nhuận đã chốt / thực thu (từ các đơn đã duyệt thành công)
            approved_gross = conn.execute(
                f"SELECT COALESCE(SUM(COALESCE(approved_commission, 0)), 0) FROM orders WHERE {date_filter} AND status IN ('approved', 'paid')"
            ).fetchone()[0]
            approved_fee = round_dong(approved_gross * 0.0098)
            approved_tax = round_dong(approved_gross * 0.10)
            approved_net = approved_gross - approved_fee - approved_tax
            realized_net_profit = round_dong(approved_net - total_cashback_committed)
            realized_net_margin = round((realized_net_profit / approved_net) * 100, 1) if approved_net > 0 else 0.0

            # Lợi nhuận danh nghĩa (trên giấy, trước thuế & phí sàn)
            paper_profit = round_dong(gross_commission - total_cashback_all)
            paper_margin = round((paper_profit / gross_commission) * 100, 1) if gross_commission > 0 else 20.0

            # Daily Trends
            trend_rows = conn.execute(f"""
                SELECT substr(COALESCE(recorded_at, approved_at), 1, 10) as day,
                       COUNT(*) as orders_count,
                       COALESCE(SUM(order_value), 0) as gmv,
                       COALESCE(SUM(CASE WHEN status != 'rejected' THEN COALESCE(approved_commission, estimated_commission, 0) ELSE 0 END), 0) as commission,
                       COALESCE(SUM(CASE WHEN status != 'rejected' THEN round(COALESCE(cashback_amount, (estimated_commission - round(estimated_commission * 0.1098)) * {self.cfg.advertised_cashback_rate})) ELSE 0 END), 0) as cashback
                  FROM orders
                 WHERE {date_filter}
                 GROUP BY day
                 ORDER BY day ASC
            """).fetchall()
            trends = []
            for tr in trend_rows:
                tr_comm = tr["commission"]
                tr_fee = round_dong(tr_comm * 0.0098)
                tr_tax = round_dong(tr_comm * 0.10)
                tr_net = tr_comm - tr_fee - tr_tax
                tr_cash = tr["cashback"] if tr["cashback"] > 0 else round_dong(tr_net * self.cfg.advertised_cashback_rate)
                tr_profit = tr_net - tr_cash
                trends.append({
                    "day": tr["day"],
                    "orders_count": tr["orders_count"],
                    "gmv": tr["gmv"],
                    "commission": round_dong(tr_comm),
                    "fee": tr_fee,
                    "tax": tr_tax,
                    "net_shopee": tr_net,
                    "cashback": round_dong(tr_cash),
                    "net_profit": round_dong(tr_profit),
                })

            # Top 5 Customers
            cust_date_filter = date_filter.replace("recorded_at", "o.recorded_at").replace("approved_at", "o.approved_at")
            top_cust_rows = conn.execute(f"""
                SELECT c.customer_id, c.display_name, c.zalo_user_id,
                       COUNT(o.order_id) as total_orders,
                       COALESCE(SUM(o.order_value), 0) as total_gmv,
                       COALESCE(SUM(CASE WHEN o.status != 'rejected' THEN COALESCE(o.approved_commission, o.estimated_commission, 0) ELSE 0 END), 0) as total_commission,
                       COALESCE(SUM(CASE WHEN o.status != 'rejected' THEN round(COALESCE(o.cashback_amount, (o.estimated_commission - round(o.estimated_commission * 0.1098)) * {self.cfg.advertised_cashback_rate})) ELSE 0 END), 0) as total_cashback
                  FROM orders o
                  JOIN customers c ON c.customer_id = o.customer_id
                 WHERE {cust_date_filter}
                 GROUP BY c.customer_id
                 ORDER BY total_commission DESC
                 LIMIT 5
            """).fetchall()
            top_customers = [dict(r) for r in top_cust_rows]

            # Top 5 Products
            product_rows = conn.execute(f"""
                SELECT o.order_id, o.order_value, o.estimated_commission, o.approved_commission, o.status,
                       r.estimate_detail, r.affiliate_url, r.source_url
                  FROM orders o
                  LEFT JOIN link_requests r ON r.request_id = o.request_id
                 WHERE {cust_date_filter}
            """).fetchall()
            
            product_map = {}
            for pr in product_rows:
                detail = json.loads(pr["estimate_detail"]) if pr["estimate_detail"] else {}
                p_name = detail.get("name") or detail.get("title") or _product_name(pr["estimate_detail"])
                if p_name not in product_map:
                    product_map[p_name] = {
                        "name": p_name,
                        "orders_count": 0,
                        "total_gmv": 0,
                        "total_commission": 0,
                        "total_cashback": 0,
                        "affiliate_url": pr["affiliate_url"],
                        "source_url": pr["source_url"],
                    }
                item = product_map[p_name]
                item["orders_count"] += 1
                item["total_gmv"] += pr["order_value"] or 0
                if pr["status"] != "rejected":
                    comm = pr["approved_commission"] or pr["estimated_commission"] or 0
                    net_comm = round_dong(comm * (1 - 0.10 - 0.0098))
                    item["total_commission"] += comm
                    item["total_cashback"] += round_dong(net_comm * self.cfg.advertised_cashback_rate)

            top_products = sorted(product_map.values(), key=lambda x: x["total_commission"], reverse=True)[:5]

            # Community & Customer Funnel Analytics
            total_group_members = conn.execute(
                "SELECT COUNT(DISTINCT customer_id) FROM activity_logs WHERE action = 'group_join'"
            ).fetchone()[0]
            
            user_date_filter = "1=1"
            if period == "today":
                user_date_filter = "date(created_at) = date('now')"
            elif period == "7d":
                user_date_filter = "date(created_at) >= date('now', '-7 days')"
            elif period == "30d":
                user_date_filter = "date(created_at) >= date('now', '-30 days')"
            elif period == "month":
                user_date_filter = "strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')"

            new_group_members = conn.execute(
                f"SELECT COUNT(DISTINCT customer_id) FROM activity_logs WHERE action = 'group_join' AND ({user_date_filter})"
            ).fetchone()[0]
            new_users = conn.execute(
                f"SELECT COUNT(*) FROM customers WHERE role = 'user' AND ({user_date_filter})"
            ).fetchone()[0]

            # Customer order map in current period (strictly non-rejected)
            orders_by_cust = conn.execute(f"""
                SELECT customer_id, COUNT(order_id) as cnt, COALESCE(SUM(order_value), 0) as gmv,
                       COALESCE(SUM(COALESCE(approved_commission, estimated_commission, 0)), 0) as comm
                FROM orders
                WHERE {date_filter} AND status != 'rejected'
                GROUP BY customer_id
            """).fetchall()
            cust_order_map = {r['customer_id']: dict(r) for r in orders_by_cust}

            buyers_all = set(cust_order_map.keys())
            buyers_cnt = len(buyers_all)
            repeat_buyers = [c for c, d in cust_order_map.items() if d['cnt'] >= 2]
            single_buyers = [c for c, d in cust_order_map.items() if d['cnt'] == 1]
            repeat_cnt = len(repeat_buyers)
            single_cnt = len(single_buyers)

            conversion_rate = round((buyers_cnt / total_group_members) * 100, 1) if total_group_members > 0 else 0.0
            repeat_rate = round((repeat_cnt / buyers_cnt) * 100, 1) if buyers_cnt > 0 else 0.0
            avg_orders = round(orders_count / buyers_cnt, 1) if buyers_cnt > 0 else 0.0

            group_member_ids = set(r[0] for r in conn.execute("SELECT DISTINCT customer_id FROM activity_logs WHERE action = 'group_join'").fetchall() if r[0])
            engaged_ids = set(r[0] for r in conn.execute(
                f"SELECT DISTINCT customer_id FROM activity_logs WHERE action IN ('group_message', 'bot_dm', 'web_link') AND ({user_date_filter})"
            ).fetchall() if r[0])
            all_user_ids = set(r[0] for r in conn.execute("SELECT customer_id FROM customers WHERE role = 'user'").fetchall() if r[0]) | group_member_ids

            potential_ids = list(engaged_ids - buyers_all)
            silent_ids = list(all_user_ids - buyers_all - set(potential_ids))

            repeat_orders = sum(cust_order_map[c]['cnt'] for c in repeat_buyers)
            repeat_gmv = sum(cust_order_map[c]['gmv'] for c in repeat_buyers)
            repeat_comm = sum(cust_order_map[c]['comm'] for c in repeat_buyers)

            single_orders = sum(cust_order_map[c]['cnt'] for c in single_buyers)
            single_gmv = sum(cust_order_map[c]['gmv'] for c in single_buyers)
            single_comm = sum(cust_order_map[c]['comm'] for c in single_buyers)

            segments = [
                {
                    "segment_id": "repeat_buyers",
                    "name": "Khách Hàng Thân Thiết (Mua Lại)",
                    "description": "Thành viên đã mua từ 2 đơn hàng trở lên trong nhóm",
                    "badge": "Khách VIP ⭐",
                    "badge_variant": "amber",
                    "icon": "Flame",
                    "users_count": repeat_cnt,
                    "orders_count": repeat_orders,
                    "total_gmv": repeat_gmv,
                    "total_commission": round_dong(repeat_comm),
                    "conversion_rate": 100.0 if repeat_cnt > 0 else 0.0,
                    "avg_order_value": round_dong(repeat_gmv / repeat_orders) if repeat_orders > 0 else 0,
                    "action_hint": "Thành viên trung thành, thường xuyên săn sale qua bot",
                },
                {
                    "segment_id": "first_buyers",
                    "name": "Khách Mua Lần Đầu",
                    "description": "Thành viên mới trải nghiệm hoàn tiền lần đầu thành công",
                    "badge": "Mới kích hoạt 🛍️",
                    "badge_variant": "blue",
                    "icon": "ShoppingBag",
                    "users_count": single_cnt,
                    "orders_count": single_orders,
                    "total_gmv": single_gmv,
                    "total_commission": round_dong(single_comm),
                    "conversion_rate": 100.0 if single_cnt > 0 else 0.0,
                    "avg_order_value": round_dong(single_gmv / single_orders) if single_orders > 0 else 0,
                    "action_hint": "Cần gửi deal hot định kỳ để kích hoạt mua lần 2",
                },
                {
                    "segment_id": "engaged_potentials",
                    "name": "Thành Viên Tương Tác (Chưa Mua)",
                    "description": "Đã chat nhóm hoặc nhắn riêng bot lấy link nhưng chưa có đơn",
                    "badge": "Tiềm năng cao 🔥",
                    "badge_variant": "emerald",
                    "icon": "MessageSquare",
                    "users_count": len(potential_ids),
                    "orders_count": 0,
                    "total_gmv": 0,
                    "total_commission": 0,
                    "conversion_rate": 0.0,
                    "avg_order_value": 0,
                    "action_hint": "Đã quan tâm sản phẩm, cần kích thích bằng mã giảm giá",
                },
                {
                    "segment_id": "new_silent",
                    "name": "Thành Viên Mới (Chưa Tương Tác)",
                    "description": "Mới vào group Zalo, đang dạo xem và chưa phát sinh hoạt động",
                    "badge": "Người mới 🌿",
                    "badge_variant": "slate",
                    "icon": "Users",
                    "users_count": len(silent_ids),
                    "orders_count": 0,
                    "total_gmv": 0,
                    "total_commission": 0,
                    "conversion_rate": 0.0,
                    "avg_order_value": 0,
                    "action_hint": "Cần tin nhắn chào mừng kèm hướng dẫn dán link nhận hoàn tiền",
                },
            ]

            community_funnel = {
                "group_members": total_group_members,
                "total_users": total_users,
                "new_group_members": new_group_members,
                "new_users": new_users,
                "buyers_count": buyers_cnt,
                "repeat_buyers_count": repeat_cnt,
                "single_buyers_count": single_cnt,
                "orders_count": orders_count,
                "conversion_rate": conversion_rate,
                "repeat_rate": repeat_rate,
                "avg_orders_per_buyer": avg_orders,
                "segments": segments,
            }

            # Touchpoint Analytics (Group, Chat Bot 1-1, Web)
            def _query_touchpoint(actions, name, description, icon, status_badge):
                placeholders = ','.join(['?'] * len(actions))
                user_rows = conn.execute(
                    f"SELECT DISTINCT customer_id FROM activity_logs WHERE action IN ({placeholders}) AND ({user_date_filter})",
                    actions
                ).fetchall()
                t_users = [r[0] for r in user_rows if r[0]]
                total_events = conn.execute(
                    f"SELECT COUNT(*) FROM activity_logs WHERE action IN ({placeholders}) AND ({user_date_filter})",
                    actions
                ).fetchone()[0]

                return {
                    "channel_id": actions[0],
                    "name": name,
                    "description": description,
                    "icon": icon,
                    "status_badge": status_badge,
                    "unique_users": len(t_users),
                    "total_events": total_events,
                    "orders_count": 0,
                    "total_gmv": 0,
                    "total_commission": 0,
                    "conversion_rate": 0.0,
                }

            channels = [
                _query_touchpoint(
                    ["group_join"],
                    "Thành viên mới vào Group Zalo",
                    "Khách mới bấm tham gia nhóm cộng đồng săn sale",
                    "Users",
                    "Nguồn tăng trưởng 🚀"
                ),
                _query_touchpoint(
                    ["group_message"],
                    "Nhắn tin tương tác trong Group",
                    "Chat, hỏi mã giảm giá & gửi link công khai trong nhóm",
                    "MessageSquare",
                    "Tương tác cộng đồng 🔥"
                ),
                _query_touchpoint(
                    ["bot_dm"],
                    "Nhắn tin riêng 1-1 cho Bot",
                    "Inbox trực tiếp cho Bot Zalo để nhận link kín đáo",
                    "Bot",
                    "Tỷ lệ chốt đơn cao 💎"
                ),
                _query_touchpoint(
                    ["login", "web_link", "web_use"],
                    "Khách truy cập & dùng Website",
                    "Đăng nhập web, dán link rút gọn & cập nhật STK ngân hàng",
                    "Globe",
                    "Khách hàng số hóa ⭐"
                ),
            ]

        metrics = {
            "period": period,
            "is_admin": is_admin,
            "total_users": total_users,
            "total_employees": total_employees,
            "active_24h": active_24h,
            "orders": {
                "total": orders_count,
                "awaiting": awaiting_count,
                "approved": approved_count,
                "paid": paid_count,
                "rejected": rejected_count,
            },
            "kpis": {
                "total_gmv": total_gmv,
                "aov": aov,
                "avg_commission": avg_commission,
                "approval_rate": approval_rate,
                "net_margin": estimated_net_margin,
                "real_net_margin": realized_net_margin,
                "estimated_net_margin": estimated_net_margin,
                "paper_margin": paper_margin,
            },
            "cached_products": cached_products,
            "total_logs": total_logs,
            "trends": trends,
            "top_customers": top_customers,
            "top_products": top_products,
            "channels": channels,
            "community_funnel": community_funnel,
            "financials": {
                "gross_commission": round_dong(gross_commission) if is_admin else None,
                "shopee_fee": shopee_fee if is_admin else None,
                "tax_withheld": tax_withheld if is_admin else None,
                "net_from_shopee": net_from_shopee if is_admin else None,
                "cashback_paid": cashback_paid if is_admin else None,
                "cashback_ready": cashback_ready if is_admin else None,
                "cashback_pipeline": cashback_pipeline if is_admin else None,
                "total_cashback": total_cashback_all if is_admin else None,
                "total_cashback_all": total_cashback_all if is_admin else None,
                "total_cashback_committed": total_cashback_committed if is_admin else None,
                "net_profit": estimated_net_profit if is_admin else None,
                "actual_net_profit": estimated_net_profit if is_admin else None,
                "estimated_net_profit": estimated_net_profit if is_admin else None,
                "estimated_net_margin": estimated_net_margin if is_admin else None,
                "realized_net_profit": realized_net_profit if is_admin else None,
                "realized_net_margin": realized_net_margin if is_admin else None,
                "real_net_margin": estimated_net_margin if is_admin else None,
                "paper_profit": paper_profit if is_admin else None,
                "paper_margin": paper_margin if is_admin else None,
            } if is_admin else None,
        }
        return self._json({"ok": True, "metrics": metrics})

    def _admin_users(self):
        cust_id, cust = self._session_customer_info()
        if not cust or cust.get("role") not in ("admin", "employee"):
            return self._json({"ok": False, "message": "unauthorized"}, 403)

        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        page = max(1, int(qs.get("page", ["1"])[0])) if qs.get("page", ["1"])[0].isdigit() else 1
        limit = min(200, max(1, int(qs.get("limit", ["20"])[0]))) if qs.get("limit", ["20"])[0].isdigit() else 20
        search = (qs.get("search", [""])[0] or "").strip().lower()
        bank_filter = qs.get("bank", ["all"])[0]
        sort_by = (qs.get("sort_by", [""])[0] or "").strip().lower()
        sort_order = "ASC" if (qs.get("sort_order", ["desc"])[0] or "").strip().lower() == "asc" else "DESC"

        where_clauses = ["c.role = 'user'"]
        params = []
        if search:
            where_clauses.append("(LOWER(c.customer_id) LIKE ? OR LOWER(COALESCE(c.display_name, '')) LIKE ? OR LOWER(COALESCE(c.zalo_user_id, '')) LIKE ? OR LOWER(COALESCE(c.bank_account, '')) LIKE ? OR LOWER(COALESCE(c.bank_name, '')) LIKE ?)")
            pat = f"%{search}%"
            params.extend([pat, pat, pat, pat, pat])
        if bank_filter == "has_bank":
            where_clauses.append("c.bank_account IS NOT NULL AND c.bank_account != ''")
        elif bank_filter == "no_bank":
            where_clauses.append("(c.bank_account IS NULL OR c.bank_account = '')")

        where_sql = " AND ".join(where_clauses)
        offset = (page - 1) * limit

        sort_columns = {
            "orders": "order_count",
            "order_count": "order_count",
            "total_cashback": "total_cashback",
            "awaiting_amount": "awaiting_amount",
            "ready_amount": "ready_amount",
            "paid_amount": "paid_amount",
            "login_count": "c.login_count",
            "last_login": "COALESCE(c.last_login_at, c.created_at)",
            "last_login_at": "COALESCE(c.last_login_at, c.created_at)",
            "last_bot_activity": "COALESCE(last_bot_activity, c.created_at)",
            "created_at": "c.created_at",
            "name": "COALESCE(c.display_name, c.customer_id)",
            "customer_id": "c.customer_id",
        }
        if sort_by in sort_columns:
            col_expr = sort_columns[sort_by]
            if sort_order == "ASC" and sort_by in ("orders", "order_count", "total_cashback", "awaiting_amount", "ready_amount", "paid_amount", "login_count"):
                order_sql = f"CASE WHEN {col_expr} IS NULL THEN 1 ELSE 0 END, {col_expr} ASC"
            else:
                order_sql = f"{col_expr} {sort_order}"
        else:
            order_sql = "COALESCE(c.last_login_at, c.created_at) DESC"

        rate = self.cfg.advertised_cashback_rate

        with ledger.connect(self.cfg.db_path) as conn:
            total = conn.execute(f"SELECT COUNT(*) FROM customers c WHERE {where_sql}", params).fetchone()[0]
            rows = conn.execute(
                f"SELECT c.customer_id, c.display_name, c.zalo_user_id, c.bank_name, c.bank_account, "
                f"       c.account_holder, c.created_at, c.last_login_at, c.login_count, c.status, "
                f"       (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.customer_id) as order_count, "
                f"       (SELECT COALESCE(SUM(CASE WHEN o.status != 'rejected' THEN ROUND(COALESCE(o.cashback_amount, (o.estimated_commission - ROUND(o.estimated_commission * 0.1098)) * {rate})) ELSE 0 END), 0) FROM orders o WHERE o.customer_id = c.customer_id) as total_cashback, "
                f"       (SELECT COALESCE(SUM(ROUND(COALESCE(o.cashback_amount, (o.estimated_commission - ROUND(o.estimated_commission * 0.1098)) * {rate}))), 0) FROM orders o WHERE o.customer_id = c.customer_id AND o.status = 'awaiting_approval') as awaiting_amount, "
                f"       (SELECT COALESCE(SUM(COALESCE(o.cashback_amount, 0)), 0) FROM orders o WHERE o.customer_id = c.customer_id AND o.status = 'approved' AND o.paid_at IS NULL) as ready_amount, "
                f"       (SELECT COALESCE(SUM(COALESCE(o.cashback_amount, 0)), 0) FROM orders o WHERE o.customer_id = c.customer_id AND o.status = 'paid') as paid_amount, "
                f"       (SELECT MAX(created_at) FROM ( "
                f"           SELECT created_at FROM link_requests WHERE customer_id = c.customer_id "
                f"           UNION ALL "
                f"           SELECT created_at FROM activity_logs WHERE customer_id = c.customer_id OR (c.zalo_user_id IS NOT NULL AND c.zalo_user_id != '' AND customer_id = c.zalo_user_id) "
                f"       )) as last_bot_activity "
                f"  FROM customers c "
                f" WHERE {where_sql} "
                f" ORDER BY {order_sql} "
                f" LIMIT {limit} OFFSET {offset}",
                params
            ).fetchall()
            users = [dict(r) for r in rows]
            for u in users:
                req_rows = conn.execute("""
                    SELECT r.request_id, r.source_url, r.affiliate_url, r.created_at, r.estimate_detail
                      FROM link_requests r
                     WHERE r.customer_id = ?
                     ORDER BY r.created_at DESC
                     LIMIT 3
                """, (u["customer_id"],)).fetchall()
                reqs = []
                for r in req_rows:
                    detail = json.loads(r["estimate_detail"]) if r["estimate_detail"] else {}
                    p_name = detail.get("name") or detail.get("title") or _product_name(r["estimate_detail"])
                    reqs.append({
                        "name": p_name or r["source_url"],
                        "created_at": r["created_at"],
                        "affiliate_url": r["affiliate_url"],
                    })
                u["recent_requests"] = reqs

        total_pages = math.ceil(total / limit) if limit > 0 else 1
        return self._json({
            "ok": True,
            "users": users,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "total_pages": total_pages,
            }
        })

    def _admin_employees(self):
        cust_id, cust = self._session_customer_info()
        if not cust or cust.get("role") != "admin":
            return self._json({"ok": False, "message": "Chỉ có Admin mới có quyền quản lý nhân viên."}, 403)

        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        page = max(1, int(qs.get("page", ["1"])[0])) if qs.get("page", ["1"])[0].isdigit() else 1
        limit = min(200, max(1, int(qs.get("limit", ["20"])[0]))) if qs.get("limit", ["20"])[0].isdigit() else 20
        search = (qs.get("search", [""])[0] or "").strip().lower()
        role_filter = qs.get("role", ["all"])[0]
        sort_by = (qs.get("sort_by", [""])[0] or "").strip().lower()
        sort_order = "ASC" if (qs.get("sort_order", ["desc"])[0] or "").strip().lower() == "asc" else "DESC"

        where_clauses = ["role IN ('admin', 'employee')"]
        params = []
        if search:
            where_clauses.append("(LOWER(customer_id) LIKE ? OR LOWER(COALESCE(display_name, '')) LIKE ?)")
            pat = f"%{search}%"
            params.extend([pat, pat])
        if role_filter in ("admin", "employee"):
            where_clauses.append("role = ?")
            params.append(role_filter)

        where_sql = " AND ".join(where_clauses)
        offset = (page - 1) * limit

        sort_columns = {
            "name": "COALESCE(display_name, customer_id)",
            "customer_id": "customer_id",
            "role": "role",
            "status": "status",
            "login_count": "login_count",
            "last_login": "COALESCE(last_login_at, created_at)",
            "last_login_at": "COALESCE(last_login_at, created_at)",
            "created_at": "created_at",
        }
        order_sql = f"{sort_columns[sort_by]} {sort_order}" if sort_by in sort_columns else "created_at DESC"

        with ledger.connect(self.cfg.db_path) as conn:
            total = conn.execute(f"SELECT COUNT(*) FROM customers WHERE {where_sql}", params).fetchone()[0]
            rows = conn.execute(
                f"SELECT customer_id, display_name, role, status, created_at, last_login_at, login_count "
                f"  FROM customers "
                f" WHERE {where_sql} "
                f" ORDER BY {order_sql} "
                f" LIMIT {limit} OFFSET {offset}",
                params
            ).fetchall()
            employees = [dict(r) for r in rows]

        total_pages = math.ceil(total / limit) if limit > 0 else 1
        return self._json({
            "ok": True,
            "employees": employees,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "total_pages": total_pages,
            }
        })

    def _admin_create_employee(self):
        cust_id, cust = self._session_customer_info()
        if not cust or cust.get("role") != "admin":
            return self._json({"ok": False, "message": "unauthorized"}, 403)

        body = self._body()
        username = str(body.get("username") or "").strip()
        password = str(body.get("password") or "").strip()
        display_name = str(body.get("display_name") or username).strip()
        role = str(body.get("role") or "employee").strip()

        if not username or len(username) < 3:
            return self._json({"ok": False, "message": "Tên đăng nhập phải từ 3 ký tự"}, 400)
        if not password or len(password) < 6:
            return self._json({"ok": False, "message": "Mật khẩu phải từ 6 ký tự"}, 400)
        if role not in ("admin", "employee"):
            role = "employee"

        with ledger.connect(self.cfg.db_path) as conn:
            existing = conn.execute("SELECT customer_id FROM customers WHERE customer_id = ?", (username,)).fetchone()
            if existing:
                return self._json({"ok": False, "message": "Tài khoản này đã tồn tại"}, 400)

            now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")
            conn.execute(
                "INSERT INTO customers (customer_id, display_name, password_hash, role, status, created_at, password_set_at) "
                "VALUES (?, ?, ?, ?, 'active', ?, ?)",
                (username, display_name, accounts.hash_password(password), role, now_iso, now_iso)
            )
            conn.commit()

        return self._json({"ok": True, "message": f"Đã tạo thành công nhân viên {display_name} ({role})"})

    def _admin_update_employee(self):
        cust_id, cust = self._session_customer_info()
        if not cust or cust.get("role") != "admin":
            return self._json({"ok": False, "message": "unauthorized"}, 403)

        body = self._body()
        target_id = str(body.get("customer_id") or "").strip()
        new_role = body.get("role")
        new_status = body.get("status")
        new_password = body.get("new_password")

        if not target_id:
            return self._json({"ok": False, "message": "Thiếu customer_id"}, 400)

        with ledger.connect(self.cfg.db_path) as conn:
            target = conn.execute("SELECT customer_id, role FROM customers WHERE customer_id = ?", (target_id,)).fetchone()
            if not target:
                return self._json({"ok": False, "message": "Không tìm thấy nhân viên"}, 404)

            if target_id == "admin" and (new_role == "employee" or new_status == "disabled"):
                return self._json({"ok": False, "message": "Không thể vô hiệu hóa hoặc hạ quyền tài khoản admin gốc"}, 400)

            if new_role in ("admin", "employee"):
                conn.execute("UPDATE customers SET role = ? WHERE customer_id = ?", (new_role, target_id))
            if new_status in ("active", "disabled"):
                conn.execute("UPDATE customers SET status = ? WHERE customer_id = ?", (new_status, target_id))
            if new_password and len(str(new_password).strip()) >= 6:
                conn.execute(
                    "UPDATE customers SET password_hash = ?, password_set_at = ? WHERE customer_id = ?",
                    (accounts.hash_password(str(new_password).strip()), datetime.now(timezone.utc).isoformat(timespec="seconds"), target_id)
                )
            conn.commit()

        return self._json({"ok": True, "message": "Đã cập nhật thông tin nhân viên"})

    def _admin_orders(self):
        cust_id, cust = self._session_customer_info()
        if not cust or cust.get("role") not in ("admin", "employee"):
            return self._json({"ok": False, "message": "unauthorized"}, 403)

        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        page = max(1, int(qs.get("page", ["1"])[0])) if qs.get("page", ["1"])[0].isdigit() else 1
        limit = min(200, max(1, int(qs.get("limit", ["20"])[0]))) if qs.get("limit", ["20"])[0].isdigit() else 20
        search = (qs.get("search", [""])[0] or "").strip().lower()
        status_filter = qs.get("status", ["all"])[0]
        customer_id = qs.get("customer_id", [""])[0].strip()
        sort_by = (qs.get("sort_by", [""])[0] or "").strip().lower()
        sort_order = "ASC" if (qs.get("sort_order", ["desc"])[0] or "").strip().lower() == "asc" else "DESC"

        where_clauses = ["1=1"]
        params = []
        if search:
            where_clauses.append("(LOWER(o.order_id) LIKE ? OR LOWER(o.customer_id) LIKE ? OR LOWER(COALESCE(c.display_name, '')) LIKE ? OR LOWER(COALESCE(r.estimate_detail, '')) LIKE ?)")
            pat = f"%{search}%"
            params.extend([pat, pat, pat, pat])
        if status_filter != "all" and status_filter in ("awaiting_approval", "approved", "paid", "rejected"):
            where_clauses.append("o.status = ?")
            params.append(status_filter)
        if customer_id:
            where_clauses.append("o.customer_id = ?")
            params.append(customer_id)

        where_sql = " AND ".join(where_clauses)
        offset = (page - 1) * limit

        sort_columns = {
            "order_value": "o.order_value",
            "commission": "o.estimated_commission",
            "estimated_commission": "o.estimated_commission",
            "cashback": "o.cashback_amount",
            "cashback_amount": "o.cashback_amount",
            "date": "COALESCE(o.recorded_at, o.approved_at)",
            "recorded_at": "COALESCE(o.recorded_at, o.approved_at)",
            "order_id": "o.order_id",
            "customer": "COALESCE(c.display_name, o.customer_id)",
            "status": "o.status",
        }
        if sort_by in sort_columns:
            col_expr = sort_columns[sort_by]
            if sort_order == "ASC" and sort_by in ("order_value", "commission", "estimated_commission", "cashback", "cashback_amount"):
                order_sql = f"CASE WHEN {col_expr} IS NULL THEN 1 ELSE 0 END, {col_expr} ASC"
            else:
                order_sql = f"{col_expr} {sort_order}"
        else:
            order_sql = "COALESCE(o.recorded_at, o.approved_at) DESC"

        with ledger.connect(self.cfg.db_path) as conn:
            total = conn.execute(
                f"SELECT COUNT(*) FROM orders o "
                f"  LEFT JOIN customers c ON c.customer_id = o.customer_id "
                f"  LEFT JOIN link_requests r ON r.request_id = o.request_id "
                f" WHERE {where_sql}",
                params
            ).fetchone()[0]

            rows = conn.execute(
                f"SELECT o.order_id, o.customer_id, c.display_name as customer_name, "
                f"       o.status, o.order_value, o.estimated_commission, o.approved_commission, "
                f"       o.cashback_amount, o.recorded_at, o.approved_at, o.paid_at, "
                f"       o.rejection_reason, r.source_url, r.affiliate_url, r.estimate_detail "
                f"  FROM orders o "
                f"  LEFT JOIN customers c ON c.customer_id = o.customer_id "
                f"  LEFT JOIN link_requests r ON r.request_id = o.request_id "
                f" WHERE {where_sql} "
                f" ORDER BY {order_sql} "
                f" LIMIT {limit} OFFSET {offset}",
                params
            ).fetchall()
            orders = []
            rate = self.cfg.advertised_cashback_rate
            from ..shopee.dashboard_lookup import parse_url
            for r in rows:
                item = dict(r)
                est_raw = item.pop("estimate_detail", None)
                item["product"] = _product_name(est_raw)
                image_url = None
                item_id = None
                if est_raw:
                    try:
                        d = json.loads(est_raw)
                        image_url = d.get("image_url")
                        item_id = d.get("item_id")
                    except Exception:
                        pass
                if not item_id and (item.get("source_url") or item.get("affiliate_url")):
                    parsed = parse_url(item.get("source_url") or "") or parse_url(item.get("affiliate_url") or "")
                    if parsed:
                        _, _, parsed_item_id = parsed
                        item_id = parsed_item_id
                if item_id:
                    item["item_id"] = str(item_id)
                    cache_row = conn.execute("SELECT image_url, name FROM products_cache WHERE item_id = ?", (str(item_id),)).fetchone()
                    if cache_row:
                        if not image_url:
                            image_url = cache_row["image_url"]
                        if not item["product"]:
                            item["product"] = cache_row["name"]
                item["image_url"] = image_url

                comm = item.get("approved_commission") or item.get("estimated_commission") or 0
                cb = item.get("cashback_amount")
                if cb is None and item.get("status") != "rejected":
                    net_comm = round_dong(comm * (1 - 0.10 - 0.0098))
                    cb = round_dong(net_comm * rate)
                    item["cashback_amount"] = cb
                item["financial_breakdown"] = _calculate_order_financials(
                    comm, est_raw, cb, item.get("status", ""), rate
                )
                orders.append(item)

        total_pages = math.ceil(total / limit) if limit > 0 else 1
        return self._json({
            "ok": True,
            "orders": orders,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "total_pages": total_pages,
            }
        })

    def _admin_products(self):
        cust_id, cust = self._session_customer_info()
        if not cust or cust.get("role") not in ("admin", "employee"):
            return self._json({"ok": False, "message": "unauthorized"}, 403)

        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        page = max(1, int(qs.get("page", ["1"])[0])) if qs.get("page", ["1"])[0].isdigit() else 1
        limit = min(200, max(1, int(qs.get("limit", ["20"])[0]))) if qs.get("limit", ["20"])[0].isdigit() else 20
        search = (qs.get("search", [""])[0] or "").strip().lower()
        sort_by = (qs.get("sort_by", [""])[0] or "").strip().lower()
        sort_order = "ASC" if (qs.get("sort_order", ["desc"])[0] or "").strip().lower() == "asc" else "DESC"

        where_clauses = ["1=1"]
        params = []
        if search:
            where_clauses.append("(LOWER(name) LIKE ? OR item_id LIKE ?)")
            pat = f"%{search}%"
            params.extend([pat, pat])

        where_sql = " AND ".join(where_clauses)
        offset = (page - 1) * limit

        sort_columns = {
            "price": "p.price",
            "commission": "p.total_commission",
            "shopee_rate": "p.shopee_rate",
            "seller_rate": "p.seller_rate",
            "cashback": "p.cashback",
            "requests": "p.request_count",
            "request_count": "p.request_count",
            "orders": "order_count",
            "order_count": "order_count",
            "updated_at": "p.updated_at",
            "name": "p.name",
        }
        if sort_by in sort_columns:
            col_expr = sort_columns[sort_by]
            if sort_order == "ASC" and sort_by in ("price", "commission", "cashback", "shopee_rate", "seller_rate"):
                order_sql = f"CASE WHEN {col_expr} IS NULL THEN 1 ELSE 0 END, {col_expr} ASC"
            else:
                order_sql = f"{col_expr} {sort_order}"
        else:
            order_sql = "p.request_count DESC, p.updated_at DESC"

        products = []
        total = 0
        try:
            with ledger.connect(self.cfg.db_path) as conn:
                total = conn.execute(f"SELECT COUNT(*) FROM products_cache WHERE {where_sql}", params).fetchone()[0]
                rows = conn.execute(
                    f"SELECT p.item_id, p.shop_id, p.name, p.price, p.price_formatted, "
                    f"       p.shopee_rate, p.seller_rate, p.shopee_part, p.shopee_part_formatted, "
                    f"       p.seller_part, p.seller_part_formatted, "
                    f"       p.total_commission, p.commission_formatted, p.cashback, p.cashback_formatted, p.rate_percent, "
                    f"       p.affiliate_url, p.canonical_url, p.request_count, p.updated_at, p.image_url, "
                    f"       (SELECT COUNT(o.order_id) FROM orders o "
                    f"          LEFT JOIN link_requests r ON r.request_id = o.request_id "
                    f"         WHERE (r.source_url LIKE '%' || p.item_id || '%' OR r.estimate_detail LIKE '%' || p.item_id || '%') "
                    f"       ) as order_count "
                    f"  FROM products_cache p "
                    f" WHERE {where_sql} "
                    f" ORDER BY {order_sql} "
                    f" LIMIT {limit} OFFSET {offset}",
                    params
                ).fetchall()
                products = [dict(r) for r in rows]
                for p in products:
                    item_id = p.get("item_id")
                    name = p.get("name") or ""
                    if item_id:
                        req_rows = conn.execute("""
                            SELECT r.customer_id, c.display_name, c.zalo_user_id,
                                   c.bank_name, c.bank_account, c.account_holder,
                                   MAX(r.created_at) as last_requested_at,
                                   COUNT(r.request_id) as request_count
                              FROM link_requests r
                              LEFT JOIN customers c ON c.customer_id = r.customer_id
                             WHERE r.source_url LIKE ? OR r.estimate_detail LIKE ? OR (? != '' AND r.estimate_detail LIKE ?)
                             GROUP BY r.customer_id
                             ORDER BY last_requested_at DESC
                        """, (f"%{item_id}%", f"%{item_id}%", name[:20], f"%{name[:20]}%")).fetchall()
                        p["requesters"] = [dict(r) for r in req_rows]

                        order_rows = conn.execute(f"""
                            SELECT o.order_id, o.customer_id, c.display_name, c.zalo_user_id,
                                   c.bank_name, c.bank_account, c.account_holder,
                                   o.order_value, o.approved_commission, o.estimated_commission,
                                   COALESCE(o.cashback_amount, ROUND((COALESCE(o.approved_commission, o.estimated_commission, 0) - ROUND(COALESCE(o.approved_commission, o.estimated_commission, 0) * 0.1098)) * {self.cfg.advertised_cashback_rate})) as cashback_amount, o.status,
                                   COALESCE(o.recorded_at, o.approved_at) as order_date
                              FROM orders o
                              LEFT JOIN customers c ON c.customer_id = o.customer_id
                              LEFT JOIN link_requests r ON r.request_id = o.request_id
                             WHERE (r.source_url LIKE ? OR r.estimate_detail LIKE ? OR (? != '' AND r.estimate_detail LIKE ?))
                             ORDER BY order_date DESC
                        """, (f"%{item_id}%", f"%{item_id}%", name[:20], f"%{name[:20]}%")).fetchall()
                        p["buyers"] = [dict(r) for r in order_rows]
                        p["order_count"] = len(order_rows)
                        p["total_bought_gmv"] = sum(r["order_value"] or 0 for r in order_rows)
                    else:
                        p["requesters"] = []
                        p["buyers"] = []
                        p["order_count"] = 0
                        p["total_bought_gmv"] = 0
        except Exception:
            pass

        total_pages = math.ceil(total / limit) if limit > 0 else 1
        return self._json({
            "ok": True,
            "products": products,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "total_pages": total_pages,
            }
        })

    def _admin_logs(self):
        cust_id, cust = self._session_customer_info()
        if not cust or cust.get("role") not in ("admin", "employee"):
            return self._json({"ok": False, "message": "unauthorized"}, 403)

        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        page = max(1, int(qs.get("page", ["1"])[0])) if qs.get("page", ["1"])[0].isdigit() else 1
        limit = min(200, max(1, int(qs.get("limit", ["25"])[0]))) if qs.get("limit", ["25"])[0].isdigit() else 25
        search = (qs.get("search", [""])[0] or "").strip().lower()
        action_filter = qs.get("action", ["all"])[0]
        sort_by = (qs.get("sort_by", [""])[0] or "").strip().lower()
        sort_order = "ASC" if (qs.get("sort_order", ["desc"])[0] or "").strip().lower() == "asc" else "DESC"

        where_clauses = ["1=1"]
        params = []
        if search:
            where_clauses.append("(LOWER(l.customer_id) LIKE ? OR LOWER(COALESCE(c.display_name, '')) LIKE ? OR LOWER(l.action) LIKE ? OR LOWER(COALESCE(l.path, '')) LIKE ? OR LOWER(COALESCE(l.detail, '')) LIKE ?)")
            pat = f"%{search}%"
            params.extend([pat, pat, pat, pat, pat])
        if action_filter != "all":
            where_clauses.append("l.action = ?")
            params.append(action_filter)

        where_sql = " AND ".join(where_clauses)
        offset = (page - 1) * limit

        sort_columns = {
            "date": "l.created_at",
            "created_at": "l.created_at",
            "action": "l.action",
            "customer": "l.customer_id",
        }
        order_sql = f"{sort_columns[sort_by]} {sort_order}" if sort_by in sort_columns else "l.created_at DESC"

        logs = []
        total = 0
        try:
            with ledger.connect(self.cfg.db_path) as conn:
                total = conn.execute(
                    f"SELECT COUNT(*) FROM activity_logs l "
                    f"  LEFT JOIN customers c ON c.customer_id = l.customer_id "
                    f" WHERE {where_sql}",
                    params
                ).fetchone()[0]

                rows = conn.execute(
                    f"SELECT l.id as log_id, l.customer_id, c.display_name, l.action, l.path, l.detail, l.created_at "
                    f"  FROM activity_logs l "
                    f"  LEFT JOIN customers c ON c.customer_id = l.customer_id "
                    f" WHERE {where_sql} "
                    f" ORDER BY {order_sql} "
                    f" LIMIT {limit} OFFSET {offset}",
                    params
                ).fetchall()
                logs = [dict(r) for r in rows]
        except Exception:
            pass

        total_pages = math.ceil(total / limit) if limit > 0 else 1
        return self._json({
            "ok": True,
            "logs": logs,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "total_pages": total_pages,
            }
        })

    def _admin_mark_paid(self):
        cust_id, cust = self._session_customer_info()
        if not cust or cust.get("role") not in ("admin", "employee"):
            return self._json({"ok": False, "message": "unauthorized"}, 403)

        body = self._body()
        customer_id = str(body.get("customer_id") or "")
        order_ids = body.get("order_ids")
        if not isinstance(order_ids, list):
            return self._json({"ok": False, "message": "order_ids must be a list"}, 400)

        result = mark_paid(self.cfg, customer_id, [str(i) for i in order_ids])
        return self._json(result)

    def _admin_user_detail(self, customer_id: str):
        cust_id, cust = self._session_customer_info()
        if not cust or cust.get("role") not in ("admin", "employee"):
            return self._json({"ok": False, "message": "unauthorized"}, 403)

        with ledger.connect(self.cfg.db_path) as conn:
            user_row = conn.execute("SELECT * FROM customers WHERE customer_id = ?", (customer_id,)).fetchone()
            if not user_row:
                return self._json({"ok": False, "message": "Khách hàng không tồn tại"}, 404)
            user_data = dict(user_row)
            user_data.pop("password_hash", None)

            # Orders
            orders_rows = conn.execute("""
                SELECT o.order_id, o.customer_id, o.request_id, o.order_value,
                       o.estimated_commission, o.approved_commission, o.cashback_amount,
                       o.status, o.rejection_reason, o.recorded_at, o.approved_at, o.paid_at,
                       r.source_url, r.affiliate_url, r.estimate_detail,
                       COALESCE(
                           (SELECT p.name FROM products_cache p WHERE r.source_url LIKE '%' || p.item_id || '%' LIMIT 1),
                           'Sản phẩm Shopee'
                       ) as product
                  FROM orders o
                  LEFT JOIN link_requests r ON r.request_id = o.request_id
                 WHERE o.customer_id = ?
                 ORDER BY COALESCE(o.recorded_at, o.approved_at, o.updated_at) DESC
            """, (customer_id,)).fetchall()
            orders = []
            rate = self.cfg.advertised_cashback_rate
            for r in orders_rows:
                o = dict(r)
                est_raw = o.pop("estimate_detail", None)
                if not o.get("product") or o["product"] == "Sản phẩm Shopee":
                    p_name = _product_name(est_raw)
                    if p_name:
                        o["product"] = p_name
                comm = o.get("approved_commission") or o.get("estimated_commission") or 0
                cb = o.get("cashback_amount")
                if cb is None and o.get("status") != "rejected":
                    net_comm = round_dong(comm * (1 - 0.10 - 0.0098))
                    cb = round_dong(net_comm * rate)
                    o["cashback_amount"] = cb
                o["financial_breakdown"] = _calculate_order_financials(
                    comm, est_raw, cb, o.get("status", ""), rate
                )
                orders.append(o)

            # Link requests
            req_rows = conn.execute("""
                SELECT request_id, customer_id, created_at, source_url, affiliate_url,
                       estimated_commission, channel, status, estimate_detail
                  FROM link_requests
                 WHERE customer_id = ?
                 ORDER BY created_at DESC
                 LIMIT 100
            """, (customer_id,)).fetchall()
            requests = []
            for r in req_rows:
                detail = json.loads(r["estimate_detail"]) if r["estimate_detail"] else {}
                p_name = detail.get("name") or detail.get("title") or _product_name(r["estimate_detail"])
                requests.append({
                    "request_id": r["request_id"],
                    "source_url": r["source_url"],
                    "affiliate_url": r["affiliate_url"],
                    "created_at": r["created_at"],
                    "name": p_name or r["source_url"],
                })

            # Transfers
            transfer_rows = conn.execute("""
                SELECT id, customer_id, amount, transfer_code, note, proof_image, order_ids, created_at, created_by
                  FROM payment_transfers
                 WHERE customer_id = ?
                 ORDER BY created_at DESC
            """, (customer_id,)).fetchall()
            transfers = [dict(r) for r in transfer_rows]

            # Stats
            stats = {
                "total_cashback": sum((o.get("cashback_amount") or 0) for o in orders if o.get("status") != "rejected"),
                "paid_amount": sum((o.get("cashback_amount") or 0) for o in orders if o.get("status") == "paid"),
                "ready_amount": sum((o.get("cashback_amount") or 0) for o in orders if o.get("status") == "approved" and not o.get("paid_at")),
                "awaiting_amount": sum((o.get("cashback_amount") or 0) for o in orders if o.get("status") == "awaiting_approval"),
                "total_orders": len(orders),
                "total_requests": len(requests),
                "total_transferred": sum(t.get("amount") or 0 for t in transfers),
                "total_admin_profit": sum((o.get("financial_breakdown", {}).get("admin_profit") or 0) for o in orders if o.get("status") != "rejected"),
            }

            user_data["order_count"] = stats["total_orders"]
            user_data["total_cashback"] = stats["total_cashback"]
            user_data["paid_amount"] = stats["paid_amount"]
            user_data["ready_amount"] = stats["ready_amount"]
            user_data["awaiting_amount"] = stats["awaiting_amount"]
            last_req = requests[0]["created_at"] if requests else None
            user_data["last_bot_activity"] = last_req

            return self._json({
                "ok": True,
                "user": user_data,
                "orders": orders,
                "link_requests": requests,
                "transfers": transfers,
                "stats": stats,
            })

    def _admin_record_transfer(self):
        cust_id, cust = self._session_customer_info()
        if not cust or cust.get("role") not in ("admin", "employee"):
            return self._json({"ok": False, "message": "unauthorized"}, 403)

        body = self._body()
        customer_id = str(body.get("customer_id") or "").strip()
        if not customer_id:
            return self._json({"ok": False, "message": "Thiếu mã khách hàng (customer_id)"}, 400)
        try:
            amount = int(body.get("amount") or 0)
        except (ValueError, TypeError):
            amount = 0
        if amount <= 0:
            return self._json({"ok": False, "message": "Số tiền chuyển khoản phải lớn hơn 0"}, 400)

        transfer_code = str(body.get("transfer_code") or "").strip()
        note = str(body.get("note") or "").strip()
        proof_image = body.get("proof_image") or ""
        order_ids = body.get("order_ids")
        order_ids_str = ",".join(str(o) for o in order_ids) if isinstance(order_ids, list) else (str(order_ids) if order_ids else "")
        mark_as_paid = bool(body.get("mark_orders_paid", True))

        with ledger.connect(self.cfg.db_path) as conn:
            cur = conn.execute("""
                INSERT INTO payment_transfers (customer_id, amount, transfer_code, note, proof_image, order_ids, created_at, created_by)
                VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
            """, (customer_id, amount, transfer_code, note, proof_image, order_ids_str, cust_id))
            transfer_id = cur.lastrowid

            if mark_as_paid:
                if order_ids and isinstance(order_ids, list):
                    for oid in order_ids:
                        conn.execute("""
                            UPDATE orders SET status = 'paid', paid_at = datetime('now'), updated_at = datetime('now')
                             WHERE order_id = ? AND customer_id = ? AND status = 'approved'
                        """, (str(oid), customer_id))
                else:
                    conn.execute("""
                        UPDATE orders SET status = 'paid', paid_at = datetime('now'), updated_at = datetime('now')
                         WHERE customer_id = ? AND status = 'approved' AND paid_at IS NULL
                    """, (customer_id,))

            conn.commit()

        return self._json({
            "ok": True,
            "message": f"Đã ghi nhận chuyển khoản {amount:,}đ cho {customer_id}",
            "transfer_id": transfer_id
        })


    def _record_activity_log(self):
        body = self._body()
        action = str(body.get("action") or "").strip()
        if not action:
            return self._json({"ok": False, "message": "missing_action"}, 400)
        customer_id = body.get("customer_id")
        display_name = body.get("display_name")
        path = body.get("path")
        detail = body.get("detail")
        if isinstance(detail, dict):
            detail = json.dumps(detail, ensure_ascii=False)

        with ledger.connect(self.cfg.db_path) as conn:
            conn.execute(
                "INSERT INTO activity_logs (customer_id, action, path, detail, created_at)"
                " VALUES (?, ?, ?, ?, datetime('now'))",
                (customer_id, action, path, detail)
            )
            if action == "group_join" and customer_id:
                conn.execute(
                    "INSERT OR IGNORE INTO customers (customer_id, zalo_user_id, display_name, created_at, status)"
                    " VALUES (?, ?, ?, datetime('now'), 'active')",
                    (customer_id, customer_id, display_name or "")
                )
            conn.commit()
        return self._json({"ok": True, "action": action})

    def _shopee_preview(self):
        from ..shopee.commission import lookup
        from ..shopee.dashboard_lookup import ANY_SHOPEE_URL

        from ..shopee.dashboard_lookup import ANY_SHOPEE_URL, parse_url, is_short_link, resolve_short_link

        body = self._body()
        raw_url = str(body.get("url") or "").strip()
        match = ANY_SHOPEE_URL.search(raw_url)
        if not match:
            return self._json({"ok": False, "message": "invalid_url"}, 400)
        url = match.group(0)

        target_url = url
        if is_short_link(target_url):
            target_url = resolve_short_link(target_url)

        try:
            est = lookup(target_url, third_party=self.cfg.third_party_fallback)
        except Exception as exc:
            return self._json({"ok": False, "message": str(exc)}, 500)

        if not est or est.price <= 0:
            return self._json({"ok": True, "found": False})

        rate = self.cfg.advertised_cashback_rate
        raw_commission = est.commission
        net_commission = round_dong(raw_commission * (1 - 0.10 - 0.0098))
        cb = round_dong(net_commission * rate)

        # Upsert into products_cache if item_id can be extracted
        parsed = parse_url(target_url)
        if parsed:
            _, shop_id, item_id = parsed
            with ledger.connect(self.cfg.db_path) as conn:
                ledger.upsert_product_cache(
                    conn,
                    item_id=item_id,
                    shop_id=shop_id,
                    name=est.name,
                    price=est.price,
                    price_formatted=_vnd(est.price),
                    shopee_rate=est.shopee_rate,
                    seller_rate=est.seller_rate,
                    shopee_part=est.shopee_part,
                    shopee_part_formatted=_vnd(est.shopee_part),
                    seller_part=est.seller_part,
                    seller_part_formatted=_vnd(est.seller_part),
                    total_commission=raw_commission,
                    commission_formatted=_vnd(raw_commission),
                    is_capped=est.is_capped,
                    cashback=cb,
                    cashback_formatted=_vnd(cb),
                    rate_percent=f"{rate:.0%}",
                    canonical_url=target_url,
                    image_url=getattr(est, "image_url", "") or "",
                )
                conn.commit()

        return self._json({
            "ok": True,
            "found": True,
            "name": est.name,
            "price": est.price,
            "price_formatted": _vnd(est.price),
            "shopee_rate": est.shopee_rate,
            "shopee_part": est.shopee_part,
            "shopee_part_formatted": _vnd(est.shopee_part),
            "seller_rate": est.seller_rate,
            "seller_part": est.seller_part,
            "seller_part_formatted": _vnd(est.seller_part),
            "commission": raw_commission,
            "commission_formatted": _vnd(raw_commission),
            "is_capped": est.is_capped,
            "cashback": cb,
            "cashback_formatted": _vnd(cb),
            "rate_percent": f"{rate:.0%}",
        })

    def _shopee_convert(self):
        from ..core.identifiers import new_request_id
        from ..shopee.dashboard_lookup import ANY_SHOPEE_URL, parse_url, is_short_link, resolve_short_link
        from ..core import audit

        body = self._body()
        raw_url = str(body.get("url") or "").strip()
        match = ANY_SHOPEE_URL.search(raw_url)
        if not match:
            return self._json({"ok": False, "error": "invalid_url"}, 400)
        url = match.group(0)

        target_url = url
        if is_short_link(target_url):
            target_url = resolve_short_link(target_url)

        customer_id = self._session_customer() or str(body.get("customer_id") or "").strip()
        display_name = str(body.get("display_name") or "").strip()
        if not customer_id:
            return self._json({"ok": False, "error": "customer_id_required"}, 400)

        with ledger.connect(self.cfg.db_path) as conn:
            cust = conn.execute("SELECT customer_id FROM customers WHERE customer_id = ? OR zalo_user_id = ?", (customer_id, customer_id)).fetchone()
            if not cust:
                conn.execute("""
                    INSERT OR IGNORE INTO customers (customer_id, zalo_user_id, display_name, created_at, status)
                    VALUES (?, ?, ?, datetime('now'), 'active')
                """, (customer_id, customer_id, display_name or customer_id))
                conn.commit()
            else:
                customer_id = cust["customer_id"]

            # Check if this item_id already has an affiliate_url in products_cache
            parsed = parse_url(target_url)
            if parsed:
                _, _, item_id = parsed
                cached = ledger.get_product_cache(conn, item_id)
                if cached and cached["affiliate_url"]:
                    return self._json({
                        "ok": True,
                        "ready": True,
                        "affiliate_url": cached["affiliate_url"],
                        "cached": True,
                    })

            existing = ledger.find_reusable_request(
                conn, customer_id, url, resend_within_days=self.cfg.link_attribution_days)
            if existing is not None and existing["affiliate_url"]:
                if parsed:
                    ledger.upsert_product_cache(
                        conn, item_id=parsed[2], shop_id=parsed[1], affiliate_url=existing["affiliate_url"]
                    )
                    conn.commit()
                return self._json({
                    "ok": True,
                    "ready": True,
                    "affiliate_url": existing["affiliate_url"],
                    "request_id": existing["request_id"],
                })

            request_id = existing["request_id"] if existing else new_request_id()
            if not existing:
                ledger.record_link_request(
                    conn,
                    request_id=request_id,
                    customer_id=customer_id,
                    source_url=url,
                    affiliate_url=None,
                    estimated_commission=None,
                    channel="web",
                )
                audit.record(audit.LINK_REQUESTED, customer_id=customer_id,
                             request_id=request_id, url=url, channel="web")
                conn.commit()

            req_row = conn.execute(
                "SELECT affiliate_url FROM link_requests WHERE request_id=?", (request_id,)
            ).fetchone()
            if req_row and req_row["affiliate_url"]:
                if parsed:
                    ledger.upsert_product_cache(
                        conn, item_id=parsed[2], shop_id=parsed[1], affiliate_url=req_row["affiliate_url"]
                    )
                    conn.commit()
                return self._json({
                    "ok": True,
                    "ready": True,
                    "affiliate_url": req_row["affiliate_url"],
                    "request_id": request_id,
                })

            return self._json({
                "ok": True,
                "ready": False,
                "request_id": request_id,
            })

    def _shopee_link_status(self):
        from ..shopee.dashboard_lookup import parse_url, is_short_link, resolve_short_link

        query = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(query)
        request_id = (params.get("request_id") or [""])[0]
        if not request_id:
            return self._json({"ok": False, "message": "missing request_id"}, 400)
        with ledger.connect(self.cfg.db_path) as conn:
            row = conn.execute(
                "SELECT affiliate_url, source_url FROM link_requests WHERE request_id=?", (request_id,)
            ).fetchone()
            if not row:
                return self._json({"ok": False, "message": "not_found"}, 404)
            if row["affiliate_url"]:
                src_url = row["source_url"]
                if is_short_link(src_url):
                    src_url = resolve_short_link(src_url)
                parsed = parse_url(src_url)
                if parsed:
                    ledger.upsert_product_cache(
                        conn, item_id=parsed[2], shop_id=parsed[1], affiliate_url=row["affiliate_url"]
                    )
                    conn.commit()
                return self._json({"ok": True, "ready": True, "affiliate_url": row["affiliate_url"]})
        return self._json({"ok": True, "ready": False})

    def _shopee_smart_resolve(self):
        """Unified Smart Resolve: 12h on-demand cache refresh + instant affiliate URL reuse."""
        from ..shopee.commission import lookup
        from ..shopee.dashboard_lookup import ANY_SHOPEE_URL, parse_url, is_short_link, resolve_short_link

        body = self._body()
        raw_url = str(body.get("url") or "").strip()
        customer_id = self._session_customer() or str(body.get("customer_id") or "C0001").strip()
        display_name = str(body.get("display_name") or "").strip()
        channel = str(body.get("channel") or "zalo").strip()
        max_age_hours = float(body.get("max_age_hours") or 12.0)

        match = ANY_SHOPEE_URL.search(raw_url)
        if not match:
            return self._json({"ok": False, "error": "invalid_url"}, 400)
        url = match.group(0)

        target_url = url
        if is_short_link(target_url):
            target_url = resolve_short_link(target_url)

        parsed = parse_url(target_url)
        item_id = parsed[2] if parsed else None
        shop_id = parsed[1] if parsed else ""

        with ledger.connect(self.cfg.db_path) as conn:
            if customer_id:
                cust_row = conn.execute("SELECT customer_id FROM customers WHERE customer_id = ? OR zalo_user_id = ?", (customer_id, customer_id)).fetchone()
                if not cust_row:
                    conn.execute("""
                        INSERT OR IGNORE INTO customers (customer_id, zalo_user_id, display_name, created_at, status)
                        VALUES (?, ?, ?, datetime('now'), 'active')
                    """, (customer_id, customer_id, display_name or customer_id))
                    conn.commit()
                else:
                    customer_id = cust_row["customer_id"]

            rate = self.cfg.advertised_cashback_rate
            cached_row = ledger.get_product_cache(conn, item_id) if item_id else None

            # Case A: Cache hit with affiliate_url already generated
            if cached_row and cached_row["affiliate_url"]:
                updated_at_str = cached_row["updated_at"]
                try:
                    updated_dt = datetime.fromisoformat(updated_at_str)
                    age_seconds = (datetime.now(timezone.utc).astimezone() - updated_dt).total_seconds()
                    age_hours = age_seconds / 3600.0
                except Exception:
                    age_hours = 999.0

                # If fresh (< 12 hours) and price is known: INSTANT RESPONSE (0.005s)
                if age_hours < max_age_hours and cached_row["price"] and cached_row["price"] > 0:
                    conn.execute(
                        "UPDATE products_cache SET request_count = request_count + 1 WHERE item_id = ?",
                        (item_id,),
                    )
                    if customer_id:
                        req_id = f"R{datetime.now().strftime('%y%m%d%H%M%S')}{random.randint(10, 99)}"
                        conn.execute("""
                            INSERT OR IGNORE INTO link_requests (request_id, customer_id, created_at, source_url, affiliate_url, channel, status, estimate_detail)
                            VALUES (?, ?, datetime('now'), ?, ?, ?, 'success', ?)
                        """, (
                            req_id, customer_id, raw_url, cached_row["affiliate_url"], channel,
                            json.dumps({"name": cached_row["name"], "price": cached_row["price"], "commission": cached_row["total_commission"]}, ensure_ascii=False)
                        ))
                    conn.commit()
                    return self._json({
                        "ok": True,
                        "ready": True,
                        "source": "cache_instant",
                        "age_hours": round(age_hours, 1),
                        "item_id": item_id,
                        "shop_id": cached_row["shop_id"],
                        "name": cached_row["name"],
                        "price": cached_row["price"],
                        "price_formatted": cached_row["price_formatted"],
                        "shopee_rate": cached_row["shopee_rate"],
                        "seller_rate": cached_row["seller_rate"],
                        "shopee_part": cached_row["shopee_part"],
                        "shopee_part_formatted": cached_row["shopee_part_formatted"],
                        "seller_part": cached_row["seller_part"],
                        "seller_part_formatted": cached_row["seller_part_formatted"],
                        "total_commission": cached_row["total_commission"],
                        "commission_formatted": cached_row["commission_formatted"],
                        "is_capped": bool(cached_row["is_capped"]),
                        "cashback": cached_row["cashback"],
                        "cashback_formatted": cached_row["cashback_formatted"],
                        "rate_percent": cached_row["rate_percent"] or f"{rate:.0%}",
                        "affiliate_url": cached_row["affiliate_url"],
                    })

                # If stale (>= 12 hours): Refresh price & commission only (~0.4s), reuse affiliate_url!
                try:
                    est = lookup(target_url, third_party=self.cfg.third_party_fallback)
                except Exception:
                    est = None

                if est and est.price > 0:
                    raw_comm = est.commission
                    net_comm = round_dong(raw_comm * (1 - 0.10 - 0.0098))
                    cb = round_dong(net_comm * rate)
                    new_cached = ledger.upsert_product_cache(
                        conn,
                        item_id=item_id,
                        shop_id=shop_id or cached_row["shop_id"],
                        name=est.name,
                        price=est.price,
                        price_formatted=_vnd(est.price),
                        shopee_rate=est.shopee_rate,
                        seller_rate=est.seller_rate,
                        shopee_part=est.shopee_part,
                        shopee_part_formatted=_vnd(est.shopee_part),
                        seller_part=est.seller_part,
                        seller_part_formatted=_vnd(est.seller_part),
                        total_commission=raw_comm,
                        commission_formatted=_vnd(raw_comm),
                        is_capped=est.is_capped,
                        cashback=cb,
                        cashback_formatted=_vnd(cb),
                        rate_percent=f"{rate:.0%}",
                        affiliate_url=cached_row["affiliate_url"],
                        canonical_url=target_url,
                        image_url=getattr(est, "image_url", "") or "",
                    )
                    if customer_id:
                        req_id = f"R{datetime.now().strftime('%y%m%d%H%M%S')}{random.randint(10, 99)}"
                        conn.execute("""
                            INSERT OR IGNORE INTO link_requests (request_id, customer_id, created_at, source_url, affiliate_url, channel, status, estimate_detail)
                            VALUES (?, ?, datetime('now'), ?, ?, ?, 'success', ?)
                        """, (
                            req_id, customer_id, raw_url, cached_row["affiliate_url"], channel,
                            json.dumps({"name": est.name, "price": est.price, "commission": raw_comm}, ensure_ascii=False)
                        ))
                    conn.commit()
                    return self._json({
                        "ok": True,
                        "ready": True,
                        "source": "cache_refreshed",
                        "age_hours": 0.0,
                        "item_id": item_id,
                        "shop_id": new_cached["shop_id"],
                        "name": new_cached["name"],
                        "price": new_cached["price"],
                        "price_formatted": new_cached["price_formatted"],
                        "shopee_rate": new_cached["shopee_rate"],
                        "seller_rate": new_cached["seller_rate"],
                        "shopee_part": new_cached["shopee_part"],
                        "shopee_part_formatted": new_cached["shopee_part_formatted"],
                        "seller_part": new_cached["seller_part"],
                        "seller_part_formatted": new_cached["seller_part_formatted"],
                        "total_commission": new_cached["total_commission"],
                        "commission_formatted": new_cached["commission_formatted"],
                        "is_capped": bool(new_cached["is_capped"]),
                        "cashback": new_cached["cashback"],
                        "cashback_formatted": new_cached["cashback_formatted"],
                        "rate_percent": new_cached["rate_percent"],
                        "affiliate_url": new_cached["affiliate_url"],
                    })

        # Case B: If not in cache, delegate to standard convert flow
        return self._shopee_convert()

    def _shopee_cache_stats(self):
        """Stats on cached products and top requested items."""
        with ledger.connect(self.cfg.db_path) as conn:
            total = conn.execute("SELECT COUNT(*) FROM products_cache").fetchone()[0]
            with_aff = conn.execute(
                "SELECT COUNT(*) FROM products_cache WHERE affiliate_url IS NOT NULL"
            ).fetchone()[0]
            hot = [dict(r) for r in ledger.get_hot_products(conn, limit=10)]
        return self._json({
            "ok": True,
            "total_cached": total,
            "with_affiliate_url": with_aff,
            "top_products": hot,
        })

    def _shopee_cache_refresh_hot(self):
        """Background refresh for top hot products older than max_age_hours."""
        from ..shopee.commission import lookup

        body = self._body() if hasattr(self, "_cached_body") or int(self.headers.get("Content-Length") or 0) > 0 else {}
        limit = int(body.get("limit") or 20)
        max_age_hours = int(body.get("max_age_hours") or 6)

        refreshed = []
        with ledger.connect(self.cfg.db_path) as conn:
            stale_rows = ledger.get_stale_hot_products(conn, limit=limit, max_age_hours=max_age_hours)
            rate = self.cfg.advertised_cashback_rate

            for row in stale_rows:
                target_url = row["canonical_url"] or f"https://shopee.vn/product/{row['shop_id']}/{row['item_id']}"
                try:
                    est = lookup(target_url, third_party=self.cfg.third_party_fallback)
                    if est and est.price > 0:
                        raw_comm = est.commission
                        net_comm = round_dong(raw_comm * (1 - 0.10 - 0.0098))
                        cb = round_dong(net_comm * rate)
                        ledger.upsert_product_cache(
                            conn,
                            item_id=row["item_id"],
                            shop_id=row["shop_id"],
                            name=est.name,
                            price=est.price,
                            price_formatted=_vnd(est.price),
                            shopee_rate=est.shopee_rate,
                            seller_rate=est.seller_rate,
                            shopee_part=est.shopee_part,
                            shopee_part_formatted=_vnd(est.shopee_part),
                            seller_part=est.seller_part,
                            seller_part_formatted=_vnd(est.seller_part),
                            total_commission=raw_comm,
                            commission_formatted=_vnd(raw_comm),
                            is_capped=est.is_capped,
                            cashback=cb,
                            cashback_formatted=_vnd(cb),
                            rate_percent=f"{rate:.0%}",
                            affiliate_url=row["affiliate_url"],
                            canonical_url=target_url,
                            image_url=getattr(est, "image_url", "") or "",
                        )
                        refreshed.append({
                            "item_id": row["item_id"],
                            "name": est.name,
                            "price": est.price,
                        })
                except Exception:
                    continue
            conn.commit()

        return self._json({
            "ok": True,
            "refreshed_count": len(refreshed),
            "refreshed": refreshed,
        })

    MAX_BODY_BYTES = 65_536  # 64 KB limit to prevent memory exhaustion / DoS

    def _body(self) -> dict:
        if hasattr(self, "_cached_body"):
            return self._cached_body
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if not length or length > self.MAX_BODY_BYTES:
                self._cached_body = {}
                return self._cached_body
            self._cached_body = json.loads(self.rfile.read(length).decode("utf-8")) or {}
            return self._cached_body
        except (ValueError, TypeError, UnicodeDecodeError):
            self._cached_body = {}
            return self._cached_body


class DualStackServer(ThreadingHTTPServer):
    """ThreadingHTTPServer that listens on both IPv6 and IPv4 loopback/all."""
    address_family = socket.AF_INET6

    def server_bind(self):
        try:
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        except (AttributeError, OSError):
            pass
        super().server_bind()


def _create_server(port: int, handler) -> ThreadingHTTPServer | None:
    try:
        return DualStackServer(("::", port), handler)
    except Exception:
        try:
            return ThreadingHTTPServer(("0.0.0.0", port), handler)
        except Exception:
            return None


def serve(cfg: Config, port: int = 8899) -> None:
    handler = type("DashboardHandler", (_Handler,), {"cfg": cfg})
    server = _create_server(port, handler) or ThreadingHTTPServer(("127.0.0.1", port), handler)
    print(f"Dashboard on http://127.0.0.1:{port}")
    if port not in (0, 80):
        p80 = _create_server(80, handler)
        if p80 is not None:
            threading.Thread(target=p80.serve_forever, daemon=True).start()
            print("Also listening on port 80 for Cloudflare Tunnel")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


def serve_in_background(cfg: Config, port: int = 8899) -> ThreadingHTTPServer:
    handler = type("DashboardHandler", (_Handler,), {"cfg": cfg})
    server = _create_server(port, handler) or ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    # Also bind to port 80 if available so Cloudflare Tunnel pointing to localhost:80 works
    if port not in (0, 80):
        p80 = _create_server(80, handler)
        if p80 is not None:
            threading.Thread(target=p80.serve_forever, daemon=True).start()

    return server
