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
import mimetypes
import re
import threading
import urllib.parse
from datetime import datetime
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
        item["cashback"] = round_dong((item["estimated_commission"] or 0) * rate)
        out.append(item)
    return out


def _product_name(detail: str | None) -> str:
    if not detail:
        return ""
    from ..shopee.commission import Estimate

    estimate = Estimate.from_json(detail)
    return estimate.name if estimate else ""


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
    pipeline_commission = sum(r["estimated_commission"] or 0 for r in pipeline)
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
            "pipeline": round_dong(pipeline_commission * rate),
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
            item["cashback"] = round_dong(
                (item["estimated_commission"] or 0) * rate)
            item["is_estimate"] = True
        else:
            item["cashback"] = item["cashback_amount"]
            item["is_estimate"] = False
        orders.append(item)

    return {
        "customer_id": customer_id,
        "display_name": (customer["display_name"] if customer else "") or "",
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
LOOPBACK = {"127.0.0.1", "::1", "localhost"}


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

    _extra_headers: list[tuple[str, str]] = []

    def _send(self, status: int, body: bytes, content_type: str):
        try:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            for name, value in self._extra_headers:
                self.send_header(name, value)
            self._extra_headers = []
            self.end_headers()
            self.wfile.write(body)
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            pass

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
        return (self.client_address[0] or "") in LOOPBACK

    def _session_customer(self) -> str | None:
        token = _cookies(self.headers.get("Cookie")).get(SESSION_COOKIE, "")
        if not token:
            return None
        with ledger.connect(self.cfg.db_path) as conn:
            customer_id = accounts.customer_for_token(conn, token)
            conn.commit()
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
            if not self.from_loopback:
                return self._json({"ok": False, "message": "forbidden"}, 403)
            return self._json(
                snapshot(self.cfg.db_path, self.cfg.advertised_cashback_rate))
        if path == "/api/labels":
            return self._json(labels())
        if path == "/api/site":
            # Public: the figures the landing page quotes. Policy rather
            # than wording, so not in the labels file -- and deliberately
            # not read from /api/payouts, which never leaves loopback.
            return self._json(site_figures(self.cfg))
        if path == "/api/shopee/link-status":
            return self._shopee_link_status()
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
        self._send(200, target.read_bytes(), kind)

    # -- POST -----------------------------------------------------------
    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        parts = path.strip("/").split("/")

        if path == "/api/auth/login":
            return self._login()
        if path == "/api/auth/logout":
            return self._logout()
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

        # /api/customers/<id>/paid  and  /api/customers/<id>/ask-bank
        if len(parts) == 4 and parts[:2] == ["api", "customers"]:
            if not self.from_loopback:
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

        customer_id = self._session_customer()
        if customer_id is None:
            return self._json({"ok": False, "message": "not_signed_in"}, 401)
        body = self._body()
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

    def _shopee_preview(self):
        from ..shopee.commission import lookup
        from ..shopee.dashboard_lookup import ANY_SHOPEE_URL

        body = self._body()
        raw_url = str(body.get("url") or "").strip()
        match = ANY_SHOPEE_URL.search(raw_url)
        if not match:
            return self._json({"ok": False, "message": "invalid_url"}, 400)
        url = match.group(0)

        try:
            est = lookup(url, third_party=self.cfg.third_party_fallback)
        except Exception as exc:
            return self._json({"ok": False, "message": str(exc)}, 500)

        if not est or est.price <= 0:
            return self._json({"ok": True, "found": False})

        rate = self.cfg.advertised_cashback_rate
        cb = est.cashback(rate)
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
            "commission": est.commission,
            "commission_formatted": _vnd(est.commission),
            "is_capped": est.is_capped,
            "cashback": cb,
            "cashback_formatted": _vnd(cb),
            "rate_percent": f"{rate:.0%}",
        })

    def _shopee_convert(self):
        from ..core.identifiers import new_request_id
        from ..shopee.dashboard_lookup import ANY_SHOPEE_URL
        from ..core import audit

        body = self._body()
        raw_url = str(body.get("url") or "").strip()
        match = ANY_SHOPEE_URL.search(raw_url)
        if not match:
            return self._json({"ok": False, "error": "invalid_url"}, 400)
        url = match.group(0)

        customer_id = self._session_customer() or str(body.get("customer_id") or "").strip().upper()
        if not customer_id:
            return self._json({"ok": False, "error": "need_customer_id"}, 400)

        with ledger.connect(self.cfg.db_path) as conn:
            cust = ledger.get_customer(conn, customer_id)
            if not cust:
                return self._json({"ok": False, "error": "customer_not_found"}, 404)

            existing = ledger.find_reusable_request(
                conn, customer_id, url, resend_within_days=self.cfg.link_attribution_days)
            if existing is not None and existing["affiliate_url"]:
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
        query = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(query)
        request_id = (params.get("request_id") or [""])[0]
        if not request_id:
            return self._json({"ok": False, "message": "missing request_id"}, 400)
        with ledger.connect(self.cfg.db_path) as conn:
            row = conn.execute(
                "SELECT affiliate_url FROM link_requests WHERE request_id=?", (request_id,)
            ).fetchone()
        if not row:
            return self._json({"ok": False, "message": "not_found"}, 404)
        if row["affiliate_url"]:
            return self._json({"ok": True, "ready": True, "affiliate_url": row["affiliate_url"]})
        return self._json({"ok": True, "ready": False})

    MAX_BODY_BYTES = 65_536  # 64 KB limit to prevent memory exhaustion / DoS

    def _body(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if not length or length > self.MAX_BODY_BYTES:
                return {}
            return json.loads(self.rfile.read(length).decode("utf-8")) or {}
        except (ValueError, TypeError, UnicodeDecodeError):
            return {}


def serve(cfg: Config, port: int = 8899) -> None:
    handler = type("DashboardHandler", (_Handler,), {"cfg": cfg})
    # Loopback only. This serves bank account numbers.
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    print(f"Dashboard on http://127.0.0.1:{port}")
    print("Loopback only -- it shows bank details. Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


def serve_in_background(cfg: Config, port: int = 8899) -> ThreadingHTTPServer:
    handler = type("DashboardHandler", (_Handler,), {"cfg": cfg})
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server
