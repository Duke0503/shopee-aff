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

import hashlib
import hmac
import json
import math
import mimetypes
import os
import random
import re
import socket
import subprocess
import threading
import time
import urllib.parse
from datetime import datetime, timezone, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import logging

_log = logging.getLogger("cashback.web.dashboard")

from ..core import accounts, banks
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
    from ..messaging.notifications import EXAMPLE_ORDER_VND, EXAMPLE_RATE

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


def _resolve_proof_urls(raw_url: str) -> dict:
    """Resolve any proof image URL (Google Drive, local, or external).

    Returns:
        img_src: URL suitable for <img src="..."> (direct image CDN for Google Drive).
        fallback_src: Fallback thumbnail URL if img_src fails.
        link_href: URL for clicking to view the full file.
        is_gdrive: Whether this is a Google Drive URL.
        file_id: The Google Drive file ID if applicable.
    """
    if not raw_url:
        return {"img_src": "", "fallback_src": "", "link_href": "", "is_gdrive": False, "file_id": None}

    url = str(raw_url).strip()
    file_id = None

    # Google Drive file ID patterns:
    # 1. drive.google.com/file/d/<file_id>/view...
    m = re.search(r"drive\.google\.com/file/d/([a-zA-Z0-9_-]+)", url)
    if m:
        file_id = m.group(1)
    else:
        # 2. drive.google.com/open?id=<file_id> or uc?id=<file_id>
        m = re.search(r"drive\.google\.com/(?:open|uc)\?(?:.*&)?id=([a-zA-Z0-9_-]+)", url)
        if m:
            file_id = m.group(1)
        else:
            # 3. googleusercontent.com/d/<file_id>
            m = re.search(r"googleusercontent\.com/d/([a-zA-Z0-9_-]+)", url)
            if m:
                file_id = m.group(1)
            elif re.search(r"thumbnail\?(?:.*&)?id=([a-zA-Z0-9_-]+)", url):
                m = re.search(r"thumbnail\?(?:.*&)?id=([a-zA-Z0-9_-]+)", url)
                file_id = m.group(1)

    if file_id:
        return {
            "img_src": f"https://lh3.googleusercontent.com/d/{file_id}",
            "fallback_src": f"https://drive.google.com/thumbnail?sz=w1200&id={file_id}",
            "link_href": f"https://drive.google.com/file/d/{file_id}/view?usp=sharing",
            "is_gdrive": True,
            "file_id": file_id,
        }

    return {
        "img_src": url,
        "fallback_src": "",
        "link_href": url,
        "is_gdrive": False,
        "file_id": None,
    }


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
        p_name, _ = _resolve_product_info(
            conn,
            item.pop("estimate_detail", None),
            item.get("affiliate_url"),
            item.get("source_url"),
        )
        item["product"] = p_name
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
        # Guest orders owe nobody anything; this page is about who to pay.
        "   AND COALESCE(c.role, 'user') != 'house'"
        " ORDER BY o.recorded_at DESC"
    ).fetchall()
    out = []
    for row in rows:
        item = dict(row)
        p_name, _ = _resolve_product_info(
            conn,
            item.pop("estimate_detail", None),
            item.get("affiliate_url"),
            item.get("source_url"),
        )
        item["product"] = p_name
        est_comm = item.get("estimated_commission") or 0
        net_comm = round_dong(est_comm * (1 - 0.10 - 0.0098))
        item["cashback"] = round_dong(net_comm * rate)
        out.append(item)
    return out


def _product_name(detail: str | None) -> str:
    if not detail:
        return ""
    try:
        data = json.loads(detail)
        if isinstance(data, dict):
            name = data.get("name") or data.get("title")
            if name:
                return str(name).strip()
    except Exception:
        pass
    from ..shopee.commission import Estimate

    estimate = Estimate.from_json(detail)
    return estimate.name if estimate and estimate.name else ""


def _resolve_product_info(
    conn: sqlite3.Connection,
    estimate_detail: str | None = None,
    affiliate_url: str | None = None,
    source_url: str | None = None,
) -> tuple[str, str | None]:
    """Resolve product title and thumbnail image with fallback tiers:
    1. From estimate_detail JSON (name, title, Estimate.from_json).
    2. From products_cache by affiliate_url.
    3. From products_cache by canonical_url or source_url.
    4. From products_cache by item_id (extracting item_id from URLs).
    5. Sensible fallback ('Sản phẩm Shopee', None).
    """
    name = _product_name(estimate_detail)
    image_url = None
    stored_item_id = None
    if estimate_detail:
        try:
            d = json.loads(estimate_detail)
            if isinstance(d, dict):
                image_url = d.get("image_url")
                stored_item_id = d.get("item_id")
        except Exception:
            pass

    try:
        if not name and affiliate_url:
            row = conn.execute(
                "SELECT name, image_url FROM products_cache WHERE affiliate_url = ? AND name IS NOT NULL AND name != ''",
                (affiliate_url,),
            ).fetchone()
            if row:
                if row["name"]:
                    name = row["name"]
                if not image_url and row["image_url"]:
                    image_url = row["image_url"]

        if not name and source_url:
            row = conn.execute(
                "SELECT name, image_url FROM products_cache WHERE canonical_url = ? AND name IS NOT NULL AND name != ''",
                (source_url,),
            ).fetchone()
            if row:
                if row["name"]:
                    name = row["name"]
                if not image_url and row["image_url"]:
                    image_url = row["image_url"]

        # Short links carry no item id, so the one saved with the estimate
        # is often the only way back to the product.
        if (not name or not image_url) and stored_item_id:
            row = conn.execute(
                "SELECT name, image_url FROM products_cache WHERE item_id = ?",
                (str(stored_item_id),),
            ).fetchone()
            if row:
                if not name and row["name"]:
                    name = row["name"]
                if not image_url and row["image_url"]:
                    image_url = row["image_url"]

        if not name or not image_url:
            from ..shopee.dashboard_lookup import parse_url
            for u in (source_url, affiliate_url):
                if u:
                    parsed = parse_url(u)
                    if parsed:
                        _, _, item_id = parsed
                        row = conn.execute(
                            "SELECT name, image_url FROM products_cache WHERE item_id = ? AND name IS NOT NULL AND name != ''",
                            (str(item_id),),
                        ).fetchone()
                        if row:
                            if not name and row["name"]:
                                name = row["name"]
                            if not image_url and row["image_url"]:
                                image_url = row["image_url"]
                            break
    except Exception:
        pass

    return name or "", image_url


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

def _order_campaign(conn, order_id: str) -> dict | None:
    """Where an order stands in a promotion, for the customer's own view:
    {name, rank, slots, bonus, status} for a slot, {name, slots, missed}
    when the window was right but every slot was already taken."""
    from ..ledger import campaigns

    standing = campaigns.standing_for_order(conn, order_id)
    if standing is not None:
        return {"name": standing.name, "rank": standing.rank, "slots": standing.slots,
                "bonus": standing.amount, "status": standing.status}
    missed = campaigns.missed_for_order(conn, order_id)
    if missed is not None:
        return {"name": missed["name"], "slots": missed["slots"], "missed": True}
    return None


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
            "       COALESCE(o.platform, 'shopee') as platform,"
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
            p_name, _ = _resolve_product_info(
                conn,
                item.pop("estimate_detail", None),
                item.get("affiliate_url"),
                item.get("source_url"),
            )
            item["product"] = p_name
            # An awaiting order has no settled figure, so show the estimate
            # of the customer's share and let the view label it as one.
            if item["cashback_amount"] is None:
                est_comm = item.get("estimated_commission") or 0
                plat = item.get("platform") or "shopee"
                fee_factor = (1 - 0.10 - 0.0098) if plat == "shopee" else (1 - 0.10)
                net_comm = round_dong(est_comm * fee_factor)
                item["cashback"] = round_dong(net_comm * rate)
                item["is_estimate"] = True
            else:
                item["cashback"] = item["cashback_amount"]
                item["is_estimate"] = False
            item["campaign"] = _order_campaign(conn, item["order_id"])
            orders.append(item)

    role = (customer["role"] if customer and "role" in customer.keys() else "user") or "user"
    return {
        "customer_id": customer_id,
        "customer_code": (customer["customer_code"] if customer else None) or customer_id,
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
    from ..messaging.assistant_bridge import AssistantError, AssistantSender

    if not SAFE_ID.match(customer_id or ""):
        return {"ok": False, "message": t("ask_failed", reason="bad id")}

    with ledger.connect(cfg.db_path) as conn:
        row = ledger.get_customer(conn, customer_id)
    recipient = row and (row["zalo_user_id"] or row["customer_id"])
    if not recipient:
        return {"ok": False, "message": t("ask_failed", reason="no Zalo id")}

    try:
        AssistantSender(cfg.assistant_url, cfg.assistant_token).send(
            recipient, messages.render("need_bank"))
    except AssistantError as exc:
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


# Requests from the internet, per client, per window. The customer codes are
# sequential and therefore guessable, so password guessing is bounded per
# address here and per account in accounts.login. Link endpoints are bounded
# because each new link is a browser trip to Shopee, and a flood of them is
# how the whole session ends up behind a captcha.
_LIMITS = {
    "/api/auth/login": (10, 600),
    "/api/admin/login": (10, 600),
    "/api/shopee/convert": (30, 600),
    "/api/cashback/convert": (30, 600),
    "/api/shopee/preview": (60, 600),
    "/api/cashback/preview": (60, 600),
}


# New links the web may add to the browser's queue. Codes are sequential,
# so a spammer can use real customers' codes; these ceilings bound the work
# they can create, and web_busy points them at Zalo, which is never capped.
WEB_LINKS_PER_HOUR = 60
WEB_LINKS_PER_CUSTOMER_PER_DAY = 20


class _RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[tuple[str, str], list[float]] = {}
        self._lock = threading.Lock()

    def allow(self, path: str, client: str, now: float | None = None) -> bool:
        rule = _LIMITS.get(path)
        if rule is None:
            return True
        limit, window = rule
        moment = time.monotonic() if now is None else now
        with self._lock:
            recent = [t for t in self._hits.get((path, client), [])
                      if moment - t < window]
            if len(recent) >= limit:
                self._hits[(path, client)] = recent
                return False
            recent.append(moment)
            self._hits[(path, client)] = recent
            return True


_limiter = _RateLimiter()


def _cache_payload(product, own, rate: float, source: str,
                   age_hours: float) -> dict:
    """Smart-resolve answer: shared product facts, the customer's own link."""
    return {
        "ok": True,
        "ready": True,
        "source": source,
        "age_hours": age_hours,
        "item_id": product["item_id"],
        "shop_id": product["shop_id"],
        "name": product["name"],
        "price": product["price"],
        "price_formatted": product["price_formatted"],
        "shopee_rate": product["shopee_rate"],
        "seller_rate": product["seller_rate"],
        "shopee_part": product["shopee_part"],
        "shopee_part_formatted": product["shopee_part_formatted"],
        "seller_part": product["seller_part"],
        "seller_part_formatted": product["seller_part_formatted"],
        "total_commission": product["total_commission"],
        "commission_formatted": product["commission_formatted"],
        "is_capped": bool(product["is_capped"]),
        "cashback": product["cashback"],
        "cashback_formatted": product["cashback_formatted"],
        "rate_percent": product["rate_percent"] or f"{rate:.0%}",
        "affiliate_url": own["affiliate_url"],
        "request_id": own["request_id"],
    }


class _Handler(BaseHTTPRequestHandler):
    cfg: Config

    @property
    def bridge(self):
        inst = getattr(self, "_bridge_instance", None)
        if inst is not None:
            return inst
        from ..shopee.browser_bridge import HttpBridge
        self._bridge_instance = HttpBridge(self.cfg.bridge_port, self.cfg.bridge_token)
        return self._bridge_instance

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

    def _client_ip(self) -> str:
        # Behind the tunnel every request arrives from localhost; the real
        # address is the one Cloudflare puts in this header.
        return (self.headers.get("CF-Connecting-IP")
                or (self.client_address[0] or ""))

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
            "SameSite=Lax",
        ]
        if clear:
            parts.append("Max-Age=0")
            parts.append("Expires=Thu, 01 Jan 1970 00:00:00 GMT")
        else:
            max_age = accounts.SESSION_DAYS * 86400
            parts.append(f"Max-Age={max_age}")
            exp_date = (datetime.now(timezone.utc) + timedelta(days=accounts.SESSION_DAYS)).strftime("%a, %d %b %Y %H:%M:%S GMT")
            parts.append(f"Expires={exp_date}")
        # Set Secure flag when accessed over HTTPS (direct or through Cloudflare edge)
        proto = self.headers.get("X-Forwarded-Proto") or ""
        cf_visitor = self.headers.get("CF-Visitor") or ""
        if proto.lower() == "https" or '"https"' in cf_visitor:
            parts.append("Secure")
        self._extra_headers = [("Set-Cookie", "; ".join(parts))]

    # -- GET ------------------------------------------------------------
    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path

        if path.startswith("/s/"):
            code, _, action = path[3:].strip("/").partition("/")
            return self._open_share_link(code, go=(action == "go"))

        if path.startswith("/b/"):
            bill_id = path[3:].strip("/")
            return self._serve_bill(bill_id)

        if path.startswith("/proof/gdrive/"):
            file_id = path[len("/proof/gdrive/"):].strip("/")
            return self._public_gdrive_proof_proxy(file_id)

        if path == "/api/public/proof-proxy":
            return self._public_gdrive_proof_proxy()

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
        if path == "/api/admin/payments":
            return self._admin_payments()
        if path == "/api/admin/payout-batches":
            return self._admin_payout_batches()
        if path == "/api/admin/products":
            return self._admin_products()
        if path == "/api/admin/logs":
            return self._admin_logs()
        if path == "/api/admin/campaigns":
            return self._admin_campaigns()
        if path == "/api/campaigns/offer":
            # The assistant asks this before sending a link, to say whether
            # an order from it could still win a campaign slot.
            if not self.from_loopback and not self._session_is_staff():
                return self._json({"ok": False, "message": "forbidden"}, 403)
            from ..ledger import campaigns

            query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            with ledger.connect(self.cfg.db_path) as conn:
                found = ledger.find_customer_id(conn, (query.get("customer_id") or [""])[0])
                offer = campaigns.offer_for(
                    conn, found, (query.get("platform") or ["shopee"])[0]) if found else None
            return self._json({"ok": True, "offer": offer})
        if path == "/api/labels":
            return self._json(labels())
        if path == "/api/site":
            # Public: the figures the landing page quotes. Policy rather
            # than wording, so not in the labels file -- and deliberately
            # not read from /api/payouts, which never leaves loopback.
            return self._json(site_figures(self.cfg))
        if path in ("/api/shopee/link-status", "/api/cashback/link-status"):
            return self._shopee_link_status()
        if path == "/api/shopee/cache/stats":
            return self._shopee_cache_stats()
        if path == "/api/tiktok/topdeal":
            return self._tiktok_topdeal()
        if path in ("/api/deals", "/api/shopee/deals"):
            return self._deals()
        if path == "/api/fnb/vouchers":
            return self._fnb_vouchers()
        if path == "/api/fnb/deals-of-the-day":
            return self._fnb_deals_of_the_day()
        if path == "/api/fnb/link":
            return self._fnb_link()
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
        if path.startswith("/uploads/"):
            candidate = (PROJECT_ROOT / path.lstrip("/")).resolve()
            try:
                candidate.relative_to((PROJECT_ROOT / "uploads").resolve())
                if candidate.is_file():
                    target = candidate
            except ValueError:
                pass

        if target == index and path not in ("/", "", "/index.html"):
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

        if not self.from_loopback and not _limiter.allow(path, self._client_ip()):
            # "locked" is what the login page already knows how to explain.
            return self._json({"ok": False, "error": "rate_limited",
                               "message": "locked"}, 429)

        if path == "/api/deploy-webhook":
            return self._handle_deploy_webhook()

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
        if path == "/api/admin/payments/confirm":
            return self._admin_payment_confirm()
        if path == "/api/admin/payments/ask-bank":
            return self._admin_payment_ask_bank()
        if path == "/api/admin/payments/upload-proof":
            return self._admin_upload_proof()
        if path == "/api/admin/payments/gdrive-config":
            return self._admin_gdrive_config()
        if path == "/api/admin/shopee/sync-payouts":
            return self._admin_shopee_sync_payouts()
        if path == "/api/admin/orders/settle":
            return self._admin_settle_orders()
        if path == "/api/admin/campaigns":
            return self._admin_create_campaign()
        if path == "/api/auth/password":
            return self._change_password()
        if path == "/api/me/bank":
            return self._update_bank()
        if path == "/api/me/bank/erase":
            return self._erase_bank()
        if path in ("/api/shopee/preview", "/api/cashback/preview"):
            return self._shopee_preview()
        if path in ("/api/shopee/convert", "/api/cashback/convert"):
            return self._shopee_convert()
        if path == "/api/shopee/smart-resolve":
            # The assistant's endpoint. It answers with a ready link and
            # trusts the id it is given; the web uses preview + convert.
            if not self.from_loopback and not self._session_is_staff():
                return self._json({"ok": False, "message": "forbidden"}, 403)
            return self._shopee_smart_resolve()
        if path == "/api/shopee/cache/refresh-hot":
            if not self.from_loopback and not self._session_is_staff():
                return self._json({"ok": False, "message": "forbidden"}, 403)
            return self._shopee_cache_refresh_hot()
        if path == "/api/activity/log":
            if not self.from_loopback and not self._session_is_staff():
                return self._json({"ok": False, "message": "forbidden"}, 403)
            return self._record_activity_log()
        if path == "/api/activity/group-info":
            if not self.from_loopback and not self._session_is_staff():
                return self._json({"ok": False, "message": "forbidden"}, 403)
            return self._record_group_info()
        if path == "/api/activity/sync-group-members":
            if not self.from_loopback and not self._session_is_staff():
                return self._json({"ok": False, "message": "forbidden"}, 403)
            return self._sync_group_members()
        if path == "/api/bot/customer-auth":
            if not self.from_loopback and not self._session_is_staff():
                return self._json({"ok": False, "message": "forbidden"}, 403)
            return self._bot_customer_auth()
        if path == "/api/fnb/admin/voucher":
            if not self.from_loopback and not self._session_is_staff():
                return self._json({"ok": False, "message": "forbidden"}, 403)
            return self._admin_upsert_fnb_voucher()
        if path == "/api/alerts/telegram":
            if not self.from_loopback and not self._session_is_staff():
                return self._json({"ok": False, "message": "forbidden"}, 403)
            return self._send_telegram_alert_api()

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
        name = str(body.get("name") or "").strip()
        password = str(body.get("password") or "").strip()
        with ledger.connect(self.cfg.db_path) as conn:
            result = accounts.login(conn, name, password)
            conn.commit()
        if not result.ok:
            # Failures are audited but never told apart for the caller:
            # distinguishing "no such account" from "wrong password" turns
            # the form into a way to ask who uses this service.
            audit.record(audit.LOGIN_REFUSED,
                         name=name[:40],
                         reason=result.reason)
            return self._json({"ok": False, "message": result.reason}, 401)
        audit.record(audit.LOGIN_OK, customer_id=result.customer_id)
        self._set_session(result.token)
        with ledger.connect(self.cfg.db_path) as conn:
            code = ledger.customer_code_of(conn, result.customer_id)
        return self._json({"ok": True, "customer_id": result.customer_id,
                           "customer_code": code})

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

            # Chi phí thưởng sự kiện (Campaign/Event Bonus):
            camp_row = conn.execute("""
                SELECT COUNT(DISTINCT campaign_id) as total_campaigns,
                       COALESCE(SUM(amount), 0) as total_bonus,
                       COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) as bonus_paid,
                       COALESCE(SUM(CASE WHEN status != 'void' AND status != 'paid' THEN amount ELSE 0 END), 0) as bonus_pending,
                       COUNT(id) as total_awards
                  FROM campaign_awards
                 WHERE status != 'void'
            """).fetchone()
            campaign_metrics = {
                "total_campaigns": camp_row["total_campaigns"],
                "total_bonus": camp_row["total_bonus"],
                "bonus_paid": camp_row["bonus_paid"],
                "bonus_pending": camp_row["bonus_pending"],
                "total_awards": camp_row["total_awards"],
            }
            camp_bonus_total = camp_row["total_bonus"]
            camp_bonus_paid = camp_row["bonus_paid"]
            
            # Shopee deductions:
            # - Phí dịch vụ sàn Shopee: 0.98%
            # - Thuế TNCN khấu trừ tại nguồn: 10%
            shopee_fee = round_dong(gross_commission * 0.0098)
            tax_withheld = round_dong(gross_commission * 0.10)
            net_from_shopee = round_dong(gross_commission - shopee_fee - tax_withheld)

            # Lợi nhuận dự tính: Thực nhận Shopee trừ đi TOÀN BỘ tiền sẽ chia cho khách (tiền hoàn 80% + thưởng sự kiện event bonus)
            estimated_net_profit = round_dong(net_from_shopee - total_cashback_all - camp_bonus_total)
            estimated_net_margin = round((estimated_net_profit / net_from_shopee) * 100, 1) if net_from_shopee > 0 else 20.0

            # Lợi nhuận đã chốt / thực thu (từ các đơn đã duyệt thành công trừ tiền đã hoàn & thưởng đã trả)
            approved_gross = conn.execute(
                f"SELECT COALESCE(SUM(COALESCE(approved_commission, 0)), 0) FROM orders WHERE {date_filter} AND status IN ('approved', 'paid')"
            ).fetchone()[0]
            approved_fee = round_dong(approved_gross * 0.0098)
            approved_tax = round_dong(approved_gross * 0.10)
            approved_net = approved_gross - approved_fee - approved_tax
            realized_net_profit = round_dong(approved_net - total_cashback_committed - camp_bonus_paid)
            realized_net_margin = round((realized_net_profit / approved_net) * 100, 1) if approved_net > 0 else 0.0

            # Lợi nhuận danh nghĩa (trên giấy, trước thuế & phí sàn, trừ tiền hoàn & thưởng sự kiện)
            paper_profit = round_dong(gross_commission - total_cashback_all - camp_bonus_total)
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
                p_name, _ = _resolve_product_info(
                    conn,
                    pr["estimate_detail"],
                    pr["affiliate_url"],
                    pr["source_url"],
                )
                p_name = p_name or "Sản phẩm Shopee"
                prod_key = pr["affiliate_url"] or pr["source_url"] or p_name
                if prod_key not in product_map:
                    product_map[prod_key] = {
                        "name": p_name,
                        "orders_count": 0,
                        "total_gmv": 0,
                        "total_commission": 0,
                        "total_cashback": 0,
                        "affiliate_url": pr["affiliate_url"],
                        "source_url": pr["source_url"],
                    }
                item = product_map[prod_key]
                if (not item["name"] or item["name"] == "Sản phẩm Shopee") and p_name != "Sản phẩm Shopee":
                    item["name"] = p_name
                item["orders_count"] += 1
                item["total_gmv"] += pr["order_value"] or 0
                if pr["status"] != "rejected":
                    comm = pr["approved_commission"] or pr["estimated_commission"] or 0
                    net_comm = round_dong(comm * (1 - 0.10 - 0.0098))
                    item["total_commission"] += comm
                    item["total_cashback"] += round_dong(net_comm * self.cfg.advertised_cashback_rate)

            top_products = sorted(product_map.values(), key=lambda x: x["total_commission"], reverse=True)[:5]

            # Community & Customer Funnel Analytics
            # Primary: lấy trực tiếp từ nhóm Zalo "Hoàn Tiền Shopee" (2813090100064697955)
            group_info_row = None
            try:
                group_info_row = conn.execute(
                    "SELECT group_name, total_members, group_id FROM group_info WHERE group_id = '2813090100064697955' OR group_name LIKE '%Hoàn Tiền Shopee%' ORDER BY updated_at DESC LIMIT 1"
                ).fetchone()
            except Exception:
                pass

            if group_info_row and group_info_row[1] and group_info_row[1] > 0:
                total_group_members = int(group_info_row[1])
                main_group_name = str(group_info_row[0] or "Hoàn Tiền Shopee")
                main_group_id = str(group_info_row[2] or "2813090100064697955")
            else:
                total_group_members = 37
                main_group_name = "Hoàn Tiền Shopee"
                main_group_id = "2813090100064697955"
            
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
                "group_id": main_group_id,
                "group_name": main_group_name,
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
            "campaigns": campaign_metrics,
            "financials": {
                "gross_commission": round_dong(gross_commission) if is_admin else None,
                "shopee_fee": shopee_fee if is_admin else None,
                "tax_withheld": tax_withheld if is_admin else None,
                "net_from_shopee": net_from_shopee if is_admin else None,
                "cashback_paid": cashback_paid if is_admin else None,
                "cashback_ready": cashback_ready if is_admin else None,
                "cashback_pipeline": cashback_pipeline if is_admin else None,
                "campaign_bonus_total": campaign_metrics["total_bonus"] if is_admin else None,
                "campaign_bonus_paid": campaign_metrics["bonus_paid"] if is_admin else None,
                "campaign_bonus_pending": campaign_metrics["bonus_pending"] if is_admin else None,
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
            where_clauses.append("(LOWER(c.customer_id) LIKE ? OR LOWER(COALESCE(c.customer_code, '')) LIKE ? OR LOWER(COALESCE(c.display_name, '')) LIKE ? OR LOWER(COALESCE(c.zalo_user_id, '')) LIKE ? OR LOWER(COALESCE(c.bank_account, '')) LIKE ? OR LOWER(COALESCE(c.bank_name, '')) LIKE ?)")
            pat = f"%{search}%"
            params.extend([pat, pat, pat, pat, pat, pat])
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
                f"SELECT c.customer_id, c.customer_code, c.display_name, c.zalo_user_id, c.bank_name, c.bank_account, "
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
        platform_filter = qs.get("platform", ["all"])[0].strip().lower()
        customer_id = qs.get("customer_id", [""])[0].strip()
        sort_by = (qs.get("sort_by", [""])[0] or "").strip().lower()
        sort_order = "ASC" if (qs.get("sort_order", ["desc"])[0] or "").strip().lower() == "asc" else "DESC"

        where_clauses = ["1=1"]
        params = []
        if search:
            where_clauses.append("(LOWER(o.order_id) LIKE ? OR LOWER(o.customer_id) LIKE ? OR LOWER(COALESCE(c.customer_code, '')) LIKE ? OR LOWER(COALESCE(c.display_name, '')) LIKE ? OR LOWER(COALESCE(r.estimate_detail, '')) LIKE ?)")
            pat = f"%{search}%"
            params.extend([pat, pat, pat, pat, pat])
        if status_filter != "all" and status_filter in ("awaiting_approval", "approved", "paid", "rejected"):
            where_clauses.append("o.status = ?")
            params.append(status_filter)
        settlement_filter = qs.get("settlement_status", ["all"])[0].strip().lower()
        if settlement_filter != "all" and settlement_filter in ("settled", "unsettled", "processing"):
            where_clauses.append("COALESCE(o.settlement_status, 'unsettled') = ?")
            params.append(settlement_filter)
        if platform_filter != "all" and platform_filter in ("shopee", "tiktok"):
            where_clauses.append("COALESCE(o.platform, 'shopee') = ?")
            params.append(platform_filter)
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
                f"SELECT o.order_id, o.customer_id, c.customer_code as customer_code, c.display_name as customer_name, "
                f"       o.status, o.order_value, o.estimated_commission, o.approved_commission, "
                f"       o.cashback_amount, o.recorded_at, o.approved_at, o.paid_at, "
                f"       o.rejection_reason, r.source_url, r.affiliate_url, r.estimate_detail, "
                f"       COALESCE(o.platform, 'shopee') as platform, "
                f"       COALESCE(o.settlement_status, 'unsettled') as settlement_status, "
                f"       o.payout_batch_id, o.settled_at "
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
                p_name, image_url = _resolve_product_info(
                    conn,
                    est_raw,
                    item.get("affiliate_url"),
                    item.get("source_url"),
                )
                item["product"] = p_name
                item["image_url"] = image_url

                comm = item.get("approved_commission") or item.get("estimated_commission") or 0
                cb = item.get("cashback_amount")
                if item.get("customer_id") == ledger.HOUSE_CUSTOMER_ID:
                    cb = 0  # a guest order: the whole commission is ours
                    item["cashback_amount"] = 0
                if cb is None and item.get("status") != "rejected":
                    plat = item.get("platform") or "shopee"
                    fee_factor = (1 - 0.10 - 0.0098) if plat == "shopee" else (1 - 0.10)
                    net_comm = round_dong(comm * fee_factor)
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
            "last_requested_at": "p.updated_at",
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
                    aff_url = p.get("affiliate_url") or ""
                    canon_url = p.get("canonical_url") or ""
                    if item_id:
                        match_params = (
                            f"%{item_id}%",
                            f"%{item_id}%",
                            name[:20],
                            f"%{name[:20]}%",
                            aff_url if aff_url else "___NO_AFF___",
                            canon_url if canon_url else "___NO_CANON___",
                        )
                        req_rows = conn.execute("""
                            SELECT r.customer_id, c.customer_code, c.display_name, c.zalo_user_id,
                                   c.bank_name, c.bank_account, c.account_holder,
                                   MAX(r.created_at) as last_requested_at,
                                   COUNT(r.request_id) as request_count
                              FROM link_requests r
                              LEFT JOIN customers c ON c.customer_id = r.customer_id
                             WHERE r.source_url LIKE ? 
                                OR r.estimate_detail LIKE ? 
                                OR (? != '' AND r.estimate_detail LIKE ?)
                                OR r.affiliate_url = ?
                                OR r.source_url = ?
                             GROUP BY r.customer_id
                             ORDER BY last_requested_at DESC
                        """, match_params).fetchall()
                        p["requesters"] = [dict(r) for r in req_rows]
                        real_requests = sum(r["request_count"] for r in p["requesters"])
                        if real_requests > 0:
                            p["request_count"] = real_requests
                            p["last_requested_at"] = p["requesters"][0]["last_requested_at"]
                        elif not p["requesters"]:
                            p["request_count"] = 0
                            p["last_requested_at"] = None

                        order_rows = conn.execute(f"""
                            SELECT o.order_id, o.customer_id, c.customer_code, c.display_name, c.zalo_user_id,
                                   c.bank_name, c.bank_account, c.account_holder,
                                   o.order_value, o.approved_commission, o.estimated_commission,
                                   COALESCE(o.cashback_amount, ROUND((COALESCE(o.approved_commission, o.estimated_commission, 0) - ROUND(COALESCE(o.approved_commission, o.estimated_commission, 0) * 0.1098)) * {self.cfg.advertised_cashback_rate})) as cashback_amount, o.status,
                                   COALESCE(o.recorded_at, o.approved_at) as order_date
                              FROM orders o
                              LEFT JOIN customers c ON c.customer_id = o.customer_id
                              LEFT JOIN link_requests r ON r.request_id = o.request_id
                             WHERE (r.source_url LIKE ? 
                                 OR r.estimate_detail LIKE ? 
                                 OR (? != '' AND r.estimate_detail LIKE ?)
                                 OR r.affiliate_url = ?
                                 OR r.source_url = ?)
                             ORDER BY order_date DESC
                        """, match_params).fetchall()
                        p["buyers"] = [dict(r) for r in order_rows]
                        p["order_count"] = len(order_rows)
                        p["total_bought_gmv"] = sum(r["order_value"] or 0 for r in order_rows)
                    else:
                        p["requesters"] = []
                        p["buyers"] = []
                        p["order_count"] = 0
                        p["total_bought_gmv"] = 0
                        p["last_requested_at"] = None
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
                    f"SELECT l.id as log_id, l.customer_id, c.customer_code, c.display_name, l.action, l.path, l.detail, l.created_at "
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

    def _admin_campaigns(self):
        cust_id, cust = self._session_customer_info()
        if not cust or cust.get("role") not in ("admin", "employee"):
            return self._json({"ok": False, "message": "unauthorized"}, 403)
        with ledger.connect(self.cfg.db_path) as conn:
            campaign_rows = conn.execute("SELECT * FROM campaigns ORDER BY starts_at DESC").fetchall()
            c_list = []
            for c in campaign_rows:
                cid = c["campaign_id"]
                awards = conn.execute("""
                    SELECT a.id, a.campaign_id, a.customer_id, a.order_id, a.amount,
                           a.status, a.created_at, a.confirmed_at, a.paid_at, a.notified_status,
                           o.order_value, o.status as order_status, o.recorded_at,
                           COALESCE(o.platform, 'shopee') as platform,
                           cust.display_name, cust.customer_code, cust.zalo_user_id
                      FROM campaign_awards a
                      JOIN orders o ON o.order_id = a.order_id
                      LEFT JOIN customers cust ON cust.customer_id = a.customer_id
                     WHERE a.campaign_id = ?
                     ORDER BY a.id ASC
                """, (cid,)).fetchall()
                
                c_dict = dict(c)
                c_dict["awards"] = [dict(a) for a in awards]
                c_dict["slots_used"] = len([a for a in awards if a["status"] != "void"])
                c_dict["total_bonus_awarded"] = sum(a["amount"] for a in awards if a["status"] != "void")
                c_dict["total_bonus_paid"] = sum(a["amount"] for a in awards if a["status"] == "paid")
                c_list.append(c_dict)

            summary = {
                "total_campaigns": len(c_list),
                "total_bonus_awarded": sum(c["total_bonus_awarded"] for c in c_list),
                "total_bonus_paid": sum(c["total_bonus_paid"] for c in c_list),
                "total_slots_used": sum(c["slots_used"] for c in c_list),
            }
            return self._json({"ok": True, "campaigns": c_list, "summary": summary})

    def _admin_create_campaign(self):
        cust_id, cust = self._session_customer_info()
        if not cust or cust.get("role") != "admin":
            return self._json({"ok": False, "message": "unauthorized"}, 403)
        body = self._body()
        cid = str(body.get("campaign_id") or "").strip()
        name = str(body.get("name") or "").strip()
        starts_at = str(body.get("starts_at") or "").strip()
        ends_at = str(body.get("ends_at") or "").strip()
        try:
            slots = int(body.get("slots") or 20)
        except (ValueError, TypeError):
            slots = 20
        try:
            bonus_vnd = int(body.get("bonus_vnd") or 20000)
        except (ValueError, TypeError):
            bonus_vnd = 20000
        try:
            min_order_value = int(body.get("min_order_value") or 0)
        except (ValueError, TypeError):
            min_order_value = 0
        platforms = str(body.get("platforms") or "shopee,shopeefood,tiktok").strip()
        try:
            per_customer = int(body.get("per_customer") or 0)
        except (ValueError, TypeError):
            per_customer = 0

        if not cid or not name or not starts_at or not ends_at:
            return self._json({"ok": False, "message": "Vui lòng nhập đầy đủ Mã ID, Tên, Ngày bắt đầu và kết thúc"}, 400)

        from ..ledger import campaigns
        with ledger.connect(self.cfg.db_path) as conn:
            existing = conn.execute("SELECT campaign_id FROM campaigns WHERE campaign_id = ?", (cid,)).fetchone()
            if existing:
                return self._json({"ok": False, "message": f"Chiến dịch với ID '{cid}' đã tồn tại"}, 400)
            campaigns.create(conn, cid, name, starts_at, ends_at, slots, bonus_vnd, min_order_value, platforms, "", per_customer)
            conn.commit()

        return self._json({"ok": True, "message": "Tạo chiến dịch thành công!", "campaign_id": cid})

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
                       COALESCE(o.platform, 'shopee') as platform,
                       r.source_url, r.affiliate_url, r.estimate_detail,
                       COALESCE(
                           (SELECT p.name FROM products_cache p WHERE r.source_url LIKE '%' || p.item_id || '%' LIMIT 1),
                           'Sản phẩm'
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
                p_name, _ = _resolve_product_info(
                    conn,
                    est_raw,
                    o.get("affiliate_url"),
                    o.get("source_url"),
                )
                o["product"] = p_name
                comm = o.get("approved_commission") or o.get("estimated_commission") or 0
                cb = o.get("cashback_amount")
                if cb is None and o.get("status") != "rejected":
                    plat = o.get("platform") or "shopee"
                    fee_factor = (1 - 0.10 - 0.0098) if plat == "shopee" else (1 - 0.10)
                    net_comm = round_dong(comm * fee_factor)
                    cb = round_dong(net_comm * rate)
                    o["cashback_amount"] = cb
                o["financial_breakdown"] = _calculate_order_financials(
                    comm, est_raw, cb, o.get("status", ""), rate
                )
                orders.append(o)

            # Link requests
            req_rows = conn.execute("""
                SELECT request_id, customer_id, created_at, source_url, affiliate_url,
                       estimated_commission, channel, status, estimate_detail,
                       COALESCE(platform, 'shopee') as platform
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
                    "platform": r["platform"],
                    "name": p_name or r["source_url"],
                })

            # Transfers
            transfer_rows = conn.execute("""
                SELECT id, customer_id, amount, transfer_code, note, proof_image, order_ids, created_at, created_by
                  FROM payment_transfers
                 WHERE customer_id = ?
                 ORDER BY created_at DESC
            """, (customer_id,)).fetchall()
            transfers = []
            for r in transfer_rows:
                t_dict = dict(r)
                pinfo = _resolve_proof_urls(t_dict.get("proof_image") or "")
                t_dict["proof_image_direct"] = pinfo["img_src"]
                transfers.append(t_dict)

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

    def _admin_payments(self):
        cust_id, cust = self._session_customer_info()
        if not cust or cust.get("role") not in ("admin", "employee"):
            return self._json({"ok": False, "message": "unauthorized"}, 403)

        rate = self.cfg.advertised_cashback_rate
        cat = banks.load()

        with ledger.connect(self.cfg.db_path) as conn:
            from ..ledger import campaigns

            order_rows = conn.execute("""
                SELECT o.order_id, o.customer_id, o.order_value, o.estimated_commission,
                       o.approved_commission, o.cashback_amount, o.status, o.recorded_at,
                       o.approved_at, o.paid_at, COALESCE(o.platform, 'shopee') as platform,
                       COALESCE(o.settlement_status, 'unsettled') as settlement_status,
                       o.payout_batch_id, o.settled_at,
                       r.source_url, r.affiliate_url, r.estimate_detail,
                       c.display_name, c.customer_code, c.zalo_user_id,
                       c.bank_name, c.bank_account, c.account_holder
                  FROM orders o
                  JOIN customers c ON c.customer_id = o.customer_id
                  LEFT JOIN link_requests r ON r.request_id = o.request_id
                 WHERE o.status != 'rejected' AND o.paid_at IS NULL
                   AND COALESCE(c.role, 'user') != 'house'
                 ORDER BY COALESCE(o.approved_at, o.recorded_at) DESC
            """).fetchall()

            transfer_rows = conn.execute("""
                SELECT pt.id, pt.customer_id, pt.amount, pt.transfer_code, pt.note,
                       pt.proof_image, pt.order_ids, pt.notify_mode, pt.notified_at,
                       pt.target_group, pt.created_at, pt.created_by,
                       c.customer_code, c.display_name, c.bank_name, c.bank_account
                  FROM payment_transfers pt
                  LEFT JOIN customers c ON c.customer_id = pt.customer_id
                 ORDER BY pt.created_at DESC
                 LIMIT 100
            """).fetchall()

            # Load active campaign awards mapped by order_id
            award_rows = conn.execute("""
                SELECT a.order_id, a.campaign_id, a.amount, a.status as award_status, c.name as campaign_name
                  FROM campaign_awards a
                  LEFT JOIN campaigns c ON c.campaign_id = a.campaign_id
                 WHERE a.status != 'void'
            """).fetchall()
            order_awards = {a["order_id"]: dict(a) for a in award_rows}

            customers_map: dict[str, dict] = {}
            for r in order_rows:
                cid = r["customer_id"]
                if cid not in customers_map:
                    bank_raw = (r["bank_name"] or "").strip()
                    bank_acc = (r["bank_account"] or "").strip()
                    acc_holder = (r["account_holder"] or "").strip()

                    matched_bank = banks.find(bank_raw, cat) if bank_raw else None
                    if not bank_acc or not bank_raw:
                        bank_status = "missing"
                    elif not matched_bank:
                        bank_status = "invalid_bank"
                    elif not banks.transfer_supported(matched_bank):
                        bank_status = "unsupported"
                    else:
                        bank_status = "valid"

                    bank_info = None
                    if matched_bank:
                        bank_info = {
                            "name": matched_bank.get("name"),
                            "shortName": matched_bank.get("shortName"),
                            "bin": matched_bank.get("bin"),
                            "logo": matched_bank.get("logo"),
                            "code": matched_bank.get("code"),
                        }

                    customers_map[cid] = {
                        "customer_id": cid,
                        "display_name": r["display_name"] or "",
                        "customer_code": r["customer_code"] or "",
                        "zalo_user_id": r["zalo_user_id"] or cid,
                        "bank_name": bank_raw,
                        "bank_account": bank_acc,
                        "account_holder": acc_holder,
                        "bank_status": bank_status,
                        "bank_info": bank_info,
                        "payable_amount": 0,
                        "awaiting_amount": 0,
                        "bonus": 0,
                        "total_bonus": 0,
                        "settled_bonus": 0,
                        "total_unpaid": 0,
                        "order_count": 0,
                        "order_ids": [],
                        "orders": [],
                    }

                cust_entry = customers_map[cid]
                comm = r["approved_commission"] or r["estimated_commission"] or 0
                cb = r["cashback_amount"]
                if cb is None:
                    plat = r["platform"] or "shopee"
                    fee_factor = (1 - 0.10 - 0.0098) if plat == "shopee" else (1 - 0.10)
                    net_comm = round_dong(comm * fee_factor)
                    cb = round_dong(net_comm * rate)

                p_name, _ = _resolve_product_info(
                    conn, r["estimate_detail"], r["affiliate_url"], r["source_url"]
                )

                award = order_awards.get(r["order_id"])
                bonus_val = award["amount"] if award else 0

                order_dict = {
                    "order_id": r["order_id"],
                    "order_value": r["order_value"],
                    "cashback_amount": cb,
                    "campaign_bonus": bonus_val,
                    "campaign_name": award["campaign_name"] if award else None,
                    "campaign_id": award["campaign_id"] if award else None,
                    "award_status": award["award_status"] if award else None,
                    "status": r["status"],
                    "settlement_status": r["settlement_status"] if "settlement_status" in r.keys() else "unsettled",
                    "payout_batch_id": r["payout_batch_id"] if "payout_batch_id" in r.keys() else None,
                    "settled_at": r["settled_at"] if "settled_at" in r.keys() else None,
                    "recorded_at": r["recorded_at"],
                    "approved_at": r["approved_at"],
                    "platform": r["platform"],
                    "product": p_name or "Sản phẩm",
                }
                cust_entry["orders"].append(order_dict)
                cust_entry["order_ids"].append(r["order_id"])
                cust_entry["order_count"] += 1

                is_settled = (r["settlement_status"] == "settled")
                if r["status"] == "approved" and is_settled:
                    cust_entry["payable_amount"] += (cb + bonus_val)
                    cust_entry["settled_payable_amount"] = (cust_entry.get("settled_payable_amount") or 0) + (cb + bonus_val)
                elif r["status"] == "approved":
                    cust_entry["unsettled_payable_amount"] = (cust_entry.get("unsettled_payable_amount") or 0) + (cb + bonus_val)
                elif r["status"] == "awaiting_approval":
                    cust_entry["awaiting_amount"] += (cb + bonus_val)

            payables = []
            for cid, entry in customers_map.items():
                settled_order_ids = [
                    o["order_id"] for o in entry["orders"]
                    if o["status"] == "approved" and o.get("settlement_status") == "settled"
                ]
                settled_bonus = sum(
                    o.get("campaign_bonus", 0) for o in entry["orders"]
                    if o["status"] == "approved" and o.get("settlement_status") == "settled"
                )
                total_cust_bonus = sum(o.get("campaign_bonus", 0) for o in entry["orders"])
                entry["bonus"] = settled_bonus if settled_bonus > 0 else total_cust_bonus
                entry["settled_bonus"] = settled_bonus
                entry["total_bonus"] = total_cust_bonus
                entry["unsettled_payable_amount"] = entry.get("unsettled_payable_amount") or 0
                entry["total_unpaid"] = entry["payable_amount"] + entry["unsettled_payable_amount"] + entry["awaiting_amount"]
                entry["is_fully_settled"] = (
                    entry["payable_amount"] > 0 and entry["unsettled_payable_amount"] == 0
                )

                ref = str(entry["customer_code"] or entry["customer_id"]).strip()
                entry["reference"] = ref

                # QR amount defaults to payable_amount (the settled amount ready to pay)!
                qr_amount = entry["payable_amount"] if entry["payable_amount"] > 0 else (entry["unsettled_payable_amount"] if entry["unsettled_payable_amount"] > 0 else entry["awaiting_amount"])
                if entry["bank_status"] == "valid" and entry["bank_info"] and qr_amount > 0:
                    params = urllib.parse.urlencode({
                        "amount": qr_amount,
                        "addInfo": ref,
                        "accountName": entry["account_holder"] or "",
                    })
                    entry["qr_url"] = (
                        f"https://img.vietqr.io/image/{entry['bank_info']['bin']}-{entry['bank_account']}"
                        f"-compact2.png?{params}"
                    )
                else:
                    entry["qr_url"] = None

                last_tx = conn.execute("""
                    SELECT id, amount, transfer_code, note, notify_mode, notified_at, target_group, created_at
                      FROM payment_transfers
                     WHERE customer_id = ?
                     ORDER BY created_at DESC
                     LIMIT 1
                """, (cid,)).fetchone()
                entry["last_transfer"] = dict(last_tx) if last_tx else None

                if entry["payable_amount"] > 0:
                    if entry["bank_status"] == "valid":
                        entry["payout_status"] = "ready"
                    else:
                        entry["payout_status"] = "needs_bank"
                elif entry["unsettled_payable_amount"] > 0:
                    entry["payout_status"] = "awaiting_settlement"
                elif entry["awaiting_amount"] > 0:
                    entry["payout_status"] = "awaiting"
                else:
                    entry["payout_status"] = "settled"

                payables.append(entry)

            payables.sort(key=lambda p: (
                1 if p["payable_amount"] > 0 else (2 if p["unsettled_payable_amount"] > 0 else (3 if p["awaiting_amount"] > 0 else 4)),
                -p["payable_amount"],
                -p["unsettled_payable_amount"],
                -p["awaiting_amount"]
            ))

            transfers_list = []
            for r in transfer_rows:
                t_dict = dict(r)
                pinfo = _resolve_proof_urls(t_dict.get("proof_image") or "")
                t_dict["proof_image_direct"] = pinfo["img_src"]
                transfers_list.append(t_dict)

            total_payable = sum(p["payable_amount"] for p in payables)
            total_unsettled = sum(p["unsettled_payable_amount"] for p in payables)
            total_awaiting = sum(p["awaiting_amount"] for p in payables)
            total_bonus = sum(p.get("total_bonus", 0) for p in payables)
            settled_bonus = sum(p.get("settled_bonus", 0) for p in payables)
            ready_users = sum(1 for p in payables if p["payout_status"] == "ready")
            needs_bank_users = sum(1 for p in payables if p["payout_status"] == "needs_bank")
            total_transferred = sum((t.get("amount") or 0) for t in transfers_list)

            summary = {
                "total_payable": total_payable,
                "total_unsettled": total_unsettled,
                "total_awaiting": total_awaiting,
                "total_bonus": total_bonus,
                "settled_bonus": settled_bonus,
                "pending_bonus": total_bonus - settled_bonus,
                "ready_users": ready_users,
                "needs_bank_users": needs_bank_users,
                "total_transferred": total_transferred,
                "total_transfers_count": len(transfers_list),
            }

            gdrive_url = getattr(self.cfg, "gdrive_webhook_url", "") or os.getenv("GDRIVE_WEBHOOK_URL", "").strip()

            return self._json({
                "ok": True,
                "summary": summary,
                "payables": payables,
                "transfers": transfers_list,
                "gdrive_active": bool(gdrive_url),
                "gdrive_webhook_url": gdrive_url,
            })

    def _admin_payment_confirm(self):
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
            return self._json({"ok": False, "message": "Số tiền chi trả phải lớn hơn 0"}, 400)

        transfer_code = str(body.get("transfer_code") or "").strip()
        note = str(body.get("note") or "").strip()
        proof_image = str(body.get("proof_image") or "").strip()
        order_ids = body.get("order_ids")
        order_ids_str = ",".join(str(o) for o in order_ids) if isinstance(order_ids, list) else (str(order_ids) if order_ids else "")
        notify_mode = str(body.get("notify_mode") or "both").lower()  # "dm", "group", "both", "none"
        target_group = str(body.get("target_group") or "test").lower() # "test" or "main"
        include_awaiting = bool(body.get("include_awaiting", False))

        with ledger.connect(self.cfg.db_path) as conn:
            c_row = conn.execute("SELECT * FROM customers WHERE customer_id = ?", (customer_id,)).fetchone()
            if not c_row:
                return self._json({"ok": False, "message": "Không tìm thấy khách hàng"}, 404)
            c_dict = dict(c_row)

            cur = conn.execute("""
                INSERT INTO payment_transfers (
                    customer_id, amount, transfer_code, note, proof_image,
                    order_ids, notify_mode, notified_at, target_group, created_at, created_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, datetime('now'), ?)
            """, (customer_id, amount, transfer_code, note, proof_image,
                  order_ids_str, notify_mode, target_group, cust_id))
            transfer_id = cur.lastrowid

            bonus_total = 0
            bonus_count = 0
            camp_names = ""

            marked_count = 0
            rate = getattr(self.cfg, "advertised_cashback_rate", 0.80)
            if order_ids and isinstance(order_ids, list):
                for oid in order_ids:
                    ord_row = conn.execute("SELECT * FROM orders WHERE order_id = ? AND customer_id = ?", (str(oid), customer_id)).fetchone()
                    calc_cb = None
                    if ord_row and ord_row["cashback_amount"] is None:
                        comm = ord_row["approved_commission"] or ord_row["estimated_commission"] or 0
                        plat = ord_row["platform"] or "shopee"
                        fee_factor = (1 - 0.10 - 0.0098) if plat == "shopee" else (1 - 0.10)
                        net_comm = round_dong(comm * fee_factor)
                        calc_cb = round_dong(net_comm * rate)

                    res = conn.execute("""
                        UPDATE orders
                           SET status = 'paid',
                               notified_status = 'paid',
                               cashback_amount = COALESCE(cashback_amount, ?),
                               paid_at = datetime('now'),
                               updated_at = datetime('now')
                         WHERE order_id = ? AND customer_id = ?
                    """, (calc_cb, str(oid), customer_id))
                    marked_count += res.rowcount
                marks = ",".join("?" * len(order_ids))
                paid_awards = conn.execute(f"""
                    SELECT a.amount, c.name as campaign_name
                      FROM campaign_awards a
                      LEFT JOIN campaigns c ON c.campaign_id = a.campaign_id
                     WHERE a.order_id IN ({marks}) AND a.status != 'void'
                """, [str(o) for o in order_ids]).fetchall()
                if paid_awards:
                    bonus_total = sum(a["amount"] for a in paid_awards)
                    bonus_count = len(paid_awards)
                    camp_names = ", ".join(list(dict.fromkeys(a["campaign_name"] or "Sự kiện" for a in paid_awards)))
                    conn.execute(f"""
                        UPDATE campaign_awards
                           SET status = 'paid', paid_at = datetime('now'), confirmed_at = COALESCE(confirmed_at, datetime('now'))
                         WHERE order_id IN ({marks}) AND status != 'void'
                    """, [str(o) for o in order_ids])
            else:
                status_clause = "status IN ('approved', 'awaiting_approval')" if include_awaiting else "status = 'approved'"
                res = conn.execute(f"""
                    UPDATE orders
                       SET status = 'paid',
                           notified_status = 'paid',
                           cashback_amount = COALESCE(cashback_amount, ROUND((COALESCE(approved_commission, estimated_commission, 0) * (1 - 0.10 - 0.0098)) * {rate})),
                           paid_at = datetime('now'),
                           updated_at = datetime('now')
                     WHERE customer_id = ? AND {status_clause} AND paid_at IS NULL
                """, (customer_id,))
                marked_count = res.rowcount
                paid_awards = conn.execute("""
                    SELECT a.amount, c.name as campaign_name
                      FROM campaign_awards a
                      LEFT JOIN campaigns c ON c.campaign_id = a.campaign_id
                     WHERE a.customer_id = ? AND a.status != 'void' AND a.status != 'paid'
                """, (customer_id,)).fetchall()
                if paid_awards:
                    bonus_total = sum(a["amount"] for a in paid_awards)
                    bonus_count = len(paid_awards)
                    camp_names = ", ".join(list(dict.fromkeys(a["campaign_name"] or "Sự kiện" for a in paid_awards)))
                    conn.execute("""
                        UPDATE campaign_awards
                           SET status = 'paid', paid_at = datetime('now'), confirmed_at = COALESCE(confirmed_at, datetime('now'))
                         WHERE customer_id = ? AND status != 'void' AND status != 'paid'
                    """, (customer_id,))

            # Calculate financial metrics for customer:
            # 1. Total transferred all-time (including this transfer)
            total_transferred = conn.execute(
                "SELECT COALESCE(SUM(amount), 0) FROM payment_transfers WHERE customer_id = ?",
                (customer_id,)
            ).fetchone()[0]

            # 2. Remaining unpaid balance (approved and awaiting)
            rem_rows = conn.execute("""
                SELECT status, cashback_amount, estimated_commission, approved_commission,
                       COALESCE(platform, 'shopee') as platform
                  FROM orders
                 WHERE customer_id = ? AND paid_at IS NULL AND status IN ('approved', 'awaiting_approval')
            """, (customer_id,)).fetchall()

            rate = self.cfg.advertised_cashback_rate
            rem_ready = 0
            rem_awaiting = 0
            for r in rem_rows:
                st = r["status"]
                cb = r["cashback_amount"]
                if cb is None:
                    comm = r["approved_commission"] or r["estimated_commission"] or 0
                    plat = r["platform"] or "shopee"
                    fee_factor = (1 - 0.10 - 0.0098) if plat == "shopee" else (1 - 0.10)
                    net_comm = round_dong(comm * fee_factor)
                    cb = round_dong(net_comm * rate)
                if st == "approved":
                    rem_ready += (cb or 0)
                elif st == "awaiting_approval":
                    rem_awaiting += (cb or 0)

            remaining_unpaid = rem_ready + rem_awaiting
            conn.commit()

        from ..messaging.assistant_bridge import AssistantError, AssistantSender
        sender = AssistantSender(self.cfg.assistant_url, self.cfg.assistant_token)

        display_name = c_dict.get("display_name") or customer_id
        customer_code = c_dict.get("customer_code") or customer_id
        zalo_uid = c_dict.get("zalo_user_id") or customer_id
        bank_name = c_dict.get("bank_name") or "Ngân hàng"
        bank_acc = c_dict.get("bank_account") or ""
        reference = str(body.get("reference") or body.get("transfer_memo") or customer_code).strip()
        vnd_amount = _vnd(amount)
        vnd_total_transferred = _vnd(total_transferred)

        if remaining_unpaid <= 0:
            remaining_str = "0đ (Đã tất toán toàn bộ)"
        elif rem_ready > 0 and rem_awaiting > 0:
            remaining_str = f"{_vnd(remaining_unpaid)} ({_vnd(rem_ready)} sẵn sàng + {_vnd(rem_awaiting)} tạm tính)"
        elif rem_awaiting > 0:
            remaining_str = f"{_vnd(remaining_unpaid)} (đang chờ sàn duyệt)"
        else:
            remaining_str = f"{_vnd(remaining_unpaid)}"

        from datetime import datetime, timezone, timedelta
        now_vn = datetime.now(timezone(timedelta(hours=7))).strftime("%d/%m/%Y %H:%M")

        base = str(getattr(self.cfg, "public_base_url", "") or "").rstrip("/")
        bill_url = f"{base}/b/{transfer_id}" if base else f"/b/{transfer_id}"
        bill_line = f"\n🔗 Bill: {bill_url}"
        tag_user = f"@{display_name}"

        cashback_base = max(0, amount - bonus_total)
        if bonus_total > 0:
            breakdown_lines = (
                f"  • Hoàn tiền Shopee: {_vnd(cashback_base)} ({marked_count} đơn)\n"
                f"  • Thưởng sự kiện: +{_vnd(bonus_total)} ({bonus_count} đơn - {camp_names})\n"
            )
        else:
            breakdown_lines = ""

        notifications_log = {}

        if notify_mode in ("dm", "both"):
            dm_text = (
                f"✅ Xác nhận thanh toán thành công!\n"
                f"💰 Số tiền: {vnd_amount}\n"
                f"{breakdown_lines}"
                f"📥 Tổng đã nhận: {vnd_total_transferred}\n"
                f"📅 Ngày: {now_vn}"
                f"{bill_line}\n"
                f"👤 User: {tag_user}"
            )
            try:
                sender.send(zalo_uid, dm_text)
                notifications_log["dm"] = "sent"
            except AssistantError as err:
                notifications_log["dm"] = f"failed: {err}"

        if notify_mode in ("group", "both"):
            group_text = (
                f"✅ Xác nhận thanh toán thành công!\n"
                f"💰 Số tiền: {vnd_amount}\n"
                f"{breakdown_lines}"
                f"📥 Tổng đã nhận: {vnd_total_transferred}\n"
                f"📅 Ngày: {now_vn}"
                f"{bill_line}\n"
                f"👤 User: {tag_user}"
            )
            mentions = []
            if zalo_uid and str(zalo_uid).isdigit():
                idx = group_text.find(tag_user)
                if idx != -1:
                    u16_pos = len(group_text[:idx].encode("utf-16-le")) // 2
                    u16_len = len(tag_user.encode("utf-16-le")) // 2
                    mentions.append({
                        "pos": u16_pos,
                        "uid": str(zalo_uid),
                        "len": u16_len,
                        "tag": tag_user,
                    })
                else:
                    idx = group_text.find(display_name)
                    if idx != -1:
                        u16_pos = len(group_text[:idx].encode("utf-16-le")) // 2
                        u16_len = len(display_name.encode("utf-16-le")) // 2
                        mentions.append({
                            "pos": u16_pos,
                            "uid": str(zalo_uid),
                            "len": u16_len,
                            "tag": display_name,
                        })
            try:
                sender.broadcast(group_text, group=target_group, mentions=mentions)
                notifications_log["group"] = f"sent_to_{target_group}"
            except AssistantError as err:
                notifications_log["group"] = f"failed: {err}"

        return self._json({
            "ok": True,
            "message": f"Đã ghi nhận chi trả {vnd_amount} cho {display_name} thành công!",
            "transfer_id": transfer_id,
            "marked_orders": marked_count,
            "notifications": notifications_log,
        })

    def _admin_payment_ask_bank(self):
        cust_id, cust = self._session_customer_info()
        if not cust or cust.get("role") not in ("admin", "employee"):
            return self._json({"ok": False, "message": "unauthorized"}, 403)

        body = self._body()
        customer_id = str(body.get("customer_id") or "").strip()
        custom_note = str(body.get("custom_note") or "").strip()

        with ledger.connect(self.cfg.db_path) as conn:
            row = ledger.get_customer(conn, customer_id)
            if not row:
                return self._json({"ok": False, "message": "Khách hàng không tồn tại"}, 404)
            c_dict = dict(row)

        recipient = c_dict.get("zalo_user_id") or c_dict.get("customer_id")
        if not recipient:
            return self._json({"ok": False, "message": "Khách hàng không có Zalo UID"}, 400)

        display_name = c_dict.get("display_name") or customer_id
        from ..messaging.assistant_bridge import AssistantError, AssistantSender
        sender = AssistantSender(self.cfg.assistant_url, self.cfg.assistant_token)

        msg = (
            f"👋 Chào bạn {display_name}, hệ thống Hoàn Tiền Shopping Dp xin thông báo:\n\n"
            f"Bạn hiện có tiền hoàn đã được duyệt sẵn sàng để chuyển khoản! 💸\n"
            f"Tuy nhiên, thông tin tài khoản ngân hàng nhận tiền của bạn hiện đang thiếu hoặc chưa chính xác.\n\n"
            f"👉 Bạn vui lòng nhắn lại thông tin nhận tiền vào đây theo mẫu:\n"
            f"STK: [Số tài khoản]\n"
            f"Ngân hàng: [Tên ngân hàng]\n"
            f"Chủ tài khoản: [Họ và tên viết hoa không dấu]\n\n"
            f"Hoặc đăng nhập website để cập nhật thông tin ngân hàng nhé. Cảm ơn bạn! ❤️"
        )
        if custom_note:
            msg += f"\n\n💬 Ghi chú từ admin: {custom_note}"

        try:
            sender.send(recipient, msg)
        except AssistantError as exc:
            return self._json({"ok": False, "message": f"Không thể gửi tin nhắn qua bot: {exc}"}, 500)

        return self._json({
            "ok": True,
            "message": f"Đã gửi tin nhắn nhắc cung cấp STK tới {display_name} qua Zalo!"
        })

    def _admin_upload_proof(self):
        cust_id, cust = self._session_customer_info()
        if not cust or cust.get("role") not in ("admin", "employee"):
            return self._json({"ok": False, "message": "unauthorized"}, 403)

        try:
            body = self._body(max_bytes=25 * 1024 * 1024)
        except TypeError:
            body = self._body()
        if not body:
            return self._json({"ok": False, "message": "Dữ liệu không hợp lệ hoặc kích thước ảnh vượt quá 25MB"}, 400)

        # 1. Direct Google Drive link / external URL
        gdrive_url = str(body.get("gdrive_url") or "").strip()
        if gdrive_url:
            resolved = _resolve_proof_urls(gdrive_url)
            return self._json({
                "ok": True,
                "url": gdrive_url,
                "direct_url": resolved["img_src"],
                "source": "gdrive",
                "message": "Đã lưu link Google Drive thành công",
            })

        # 2. Base64 Image upload (from file selector or Clipboard Ctrl+V)
        data_uri = str(body.get("data") or body.get("image") or "").strip()
        if not data_uri:
            return self._json({"ok": False, "message": "Thiếu dữ liệu ảnh"}, 400)

        import base64
        import uuid

        header, _, encoded = data_uri.partition(",")
        raw_b64 = encoded if encoded else header
        try:
            image_bytes = base64.b64decode(raw_b64)
        except Exception as err:
            return self._json({"ok": False, "message": f"Dữ liệu ảnh không hợp lệ: {err}"}, 400)

        ext = ".jpg"
        if "png" in header.lower():
            ext = ".png"
        elif "webp" in header.lower():
            ext = ".webp"
        elif "jpeg" in header.lower():
            ext = ".jpg"

        filename = f"proof_{int(time.time())}_{uuid.uuid4().hex[:6]}{ext}"
        
        # Save to both persistent PROJECT_ROOT/uploads/proofs and STATIC_DIR/uploads/proofs
        upload_dirs = [
            PROJECT_ROOT / "uploads" / "proofs",
            STATIC_DIR / "uploads" / "proofs",
        ]
        for udir in upload_dirs:
            udir.mkdir(parents=True, exist_ok=True)
            (udir / filename).write_bytes(image_bytes)

        # Build accessible URL
        host = self.headers.get("Host") or "127.0.0.1:8899"
        proto = "https" if (self.headers.get("X-Forwarded-Proto") == "https" or (not host.startswith("127.") and not host.startswith("localhost"))) else "http"
        public_url = f"{proto}://{host}/uploads/proofs/{filename}"

        # If user configured Google Drive Webhook/API
        gdrive_webhook = os.getenv("GDRIVE_WEBHOOK_URL", "").strip()
        if gdrive_webhook:
            try:
                secret_token = os.getenv("GDRIVE_SECRET_TOKEN", "").strip()
                payload_bytes = json.dumps({
                    "filename": filename,
                    "mimeType": "image/png" if ext == ".png" else "image/jpeg",
                    "base64": raw_b64,
                    "token": secret_token,
                }).encode("utf-8")

                import urllib.request
                import ssl
                try:
                    import certifi
                    ctx = ssl.create_default_context(cafile=certifi.where())
                except Exception:
                    ctx = ssl._create_unverified_context()
                req = urllib.request.Request(
                    gdrive_webhook,
                    data=payload_bytes,
                    headers={"Content-Type": "application/json", "User-Agent": "HoanTienDP/1.0"}
                )
                with urllib.request.urlopen(req, timeout=25, context=ctx) as resp:
                    res_json = json.loads(resp.read().decode("utf-8"))
                    if res_json.get("drive_url") or res_json.get("url"):
                        public_url = res_json.get("drive_url") or res_json.get("url")
            except Exception as err:
                _log.warning("Google Drive webhook forward failed: %s", err)

        resolved = _resolve_proof_urls(public_url)
        return self._json({
            "ok": True,
            "url": public_url,
            "direct_url": resolved["img_src"],
            "filename": filename,
            "message": "Tải ảnh biên lai lên thành công",
        })

    def _admin_gdrive_config(self):
        cust_id, cust = self._session_customer_info()
        if not cust or cust.get("role") not in ("admin", "employee"):
            return self._json({"ok": False, "message": "unauthorized"}, 403)

        body = self._body()
        webhook_url = str(body.get("gdrive_webhook_url") or "").strip()

        # Update runtime environment
        os.environ["GDRIVE_WEBHOOK_URL"] = webhook_url

        # Persist to .env
        env_path = PROJECT_ROOT / ".env"
        if env_path.exists():
            content = env_path.read_text(encoding="utf-8")
            if "GDRIVE_WEBHOOK_URL=" in content:
                lines = []
                for line in content.splitlines():
                    if line.startswith("GDRIVE_WEBHOOK_URL=") or line.startswith("GDRIVE_WEBHOOK_URL ="):
                        lines.append(f"GDRIVE_WEBHOOK_URL={webhook_url}")
                    else:
                        lines.append(line)
                env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
            else:
                with env_path.open("a", encoding="utf-8") as f:
                    f.write(f"\n# Google Drive Webhook URL (Auto upload bill)\nGDRIVE_WEBHOOK_URL={webhook_url}\n")
        else:
            env_path.write_text(f"GDRIVE_WEBHOOK_URL={webhook_url}\n", encoding="utf-8")

        return self._json({
            "ok": True,
            "gdrive_active": bool(webhook_url),
            "gdrive_webhook_url": webhook_url,
            "message": "Đã lưu cấu hình Google Drive thành công!" if webhook_url else "Đã xóa cấu hình Google Drive",
        })

    def _admin_payout_batches(self):
        cust_id, cust = self._session_customer_info()
        if not cust or cust.get("role") not in ("admin", "employee"):
            return self._json({"ok": False, "message": "unauthorized"}, 403)
        with ledger.connect(self.cfg.db_path) as conn:
            batches = [dict(b) for b in ledger.get_payout_batches(conn)]
            for b in batches:
                cnt = conn.execute(
                    "SELECT COUNT(*) FROM orders WHERE payout_batch_id = ?",
                    (b["batch_id"],)
                ).fetchone()[0]
                b["linked_orders_count"] = cnt
        return self._json({"ok": True, "batches": batches})

    def _admin_shopee_sync_payouts(self):
        cust_id, cust = self._session_customer_info()
        if not cust or cust.get("role") not in ("admin", "employee"):
            return self._json({"ok": False, "message": "unauthorized"}, 403)

        from ..shopee import payout_sync
        token = self.cfg.bridge_token
        if not token:
            return self._json({"ok": False, "message": "BRIDGE_TOKEN chưa được thiết lập"}, 400)

        try:
            import urllib.request
            st_req = urllib.request.Request(
                f"http://127.0.0.1:{self.cfg.bridge_port}/status",
                headers={"X-Bridge-Token": token}
            )
            with urllib.request.urlopen(st_req, timeout=5) as resp:
                st_data = json.loads(resp.read().decode())
                if not st_data.get("connected"):
                    return self._json({
                        "ok": False,
                        "message": "Extension chưa kết nối. Hãy mở trình duyệt bot trên máy trước."
                    }, 400)

            # Navigate to payout record page
            nav_data = json.dumps({
                "connector": "shopee_affiliate",
                "action": "navigate",
                "params": {"url": payout_sync.PAYOUT_PAGE}
            }).encode()
            nav_req = urllib.request.Request(
                f"http://127.0.0.1:{self.cfg.bridge_port}/execute",
                data=nav_data,
                headers={"X-Bridge-Token": token, "Content-Type": "application/json"}
            )
            with urllib.request.urlopen(nav_req, timeout=30) as resp:
                pass

            import time
            time.sleep(2.5)

            # Execute extract script
            ext_data = json.dumps({
                "connector": "shopee_affiliate",
                "action": "execute_script",
                "params": {"code": payout_sync.EXTRACT_SCRIPT}
            }).encode()
            ext_req = urllib.request.Request(
                f"http://127.0.0.1:{self.cfg.bridge_port}/execute",
                data=ext_data,
                headers={"X-Bridge-Token": token, "Content-Type": "application/json"}
            )
            with urllib.request.urlopen(ext_req, timeout=30) as resp:
                res_json = json.loads(resp.read().decode())
                res_val = res_json.get("value") or {}
                raw_records = (res_val.get("result") or {}).get("records") or []

            settled_count = 0
            synced_batches = []
            with ledger.connect(self.cfg.db_path) as conn:
                for r in raw_records:
                    pid = str(r.get("payoutId") or "").strip()
                    if not pid:
                        continue
                    st_num = int(r.get("payoutPaymentStatus") or 0)
                    status = "paid" if st_num == 10 else ("processing" if st_num == 1 else "failed")
                    try:
                        net_amt = int(int(r.get("totalPaymentAmount") or 0) / payout_sync.MONEY_SCALE)
                    except Exception:
                        net_amt = 0
                    try:
                        elig_amt = int(int(r.get("eligibleTotalAmount") or 0) / payout_sync.MONEY_SCALE)
                    except Exception:
                        elig_amt = net_amt

                    c_time = payout_sync._parse_ts(r.get("payoutCreatedTime")) or ledger.now()
                    p_time = payout_sync._parse_ts(r.get("payArrivalTime"))

                    ledger.save_payout_batch(
                        conn=conn,
                        batch_id=pid,
                        platform="shopee",
                        status=status,
                        amount=net_amt,
                        eligible_amount=elig_amt,
                        created_time=c_time,
                        paid_time=p_time,
                        raw_json=json.dumps(r, ensure_ascii=False)
                    )
                    synced_batches.append(pid)

                    if status == "paid":
                        paid_at = p_time or ledger.now()
                        c = ledger.settle_orders_for_batch(
                            conn=conn,
                            platform="shopee",
                            batch_id=pid,
                            settled_at=paid_at,
                            up_to_date=c_time
                        )
                        settled_count += c

            return self._json({
                "ok": True,
                "message": f"Đã đồng bộ {len(synced_batches)} đợt thanh toán từ Shopee, quyết toán {settled_count} đơn hàng.",
                "batches_count": len(synced_batches),
                "orders_settled": settled_count
            })
        except Exception as exc:
            return self._json({
                "ok": False,
                "message": f"Lỗi đồng bộ quyết toán Shopee: {exc}"
            }, 500)

    def _admin_settle_orders(self):
        cust_id, cust = self._session_customer_info()
        if not cust or cust.get("role") not in ("admin", "employee"):
            return self._json({"ok": False, "message": "unauthorized"}, 403)
        body = self._body()
        batch_id = str(body.get("batch_id") or "MANUAL").strip()
        platform = str(body.get("platform") or "shopee").strip()
        order_ids = body.get("order_ids") or []
        settled_at = body.get("settled_at") or ledger.now()

        with ledger.connect(self.cfg.db_path) as conn:
            count = ledger.settle_orders_for_batch(
                conn, platform, batch_id, settled_at, order_ids=order_ids if order_ids else None
            )
        return self._json({"ok": True, "settled_count": count})

    def _send_telegram_alert_api(self):
        body = self._body()
        alert_type = body.get("alert_type", "custom")
        from ..core import telegram_alerts
        if alert_type == "zalo_conflict":
            telegram_alerts.notify_zalo_websocket_conflict(
                reconnect_count=body.get("reconnect_count", 3),
                reason=body.get("reason", "")
            )
            return self._json({"ok": True})
        elif alert_type == "zalo_recovered":
            telegram_alerts.notify_zalo_recovered()
            return self._json({"ok": True})
        elif alert_type == "shopee_captcha":
            telegram_alerts.notify_shopee_captcha(
                hint=body.get("hint", ""),
                current_url=body.get("current_url", "")
            )
            return self._json({"ok": True})
        elif alert_type == "shopee_session":
            telegram_alerts.notify_shopee_session_expired(
                hint=body.get("hint", ""),
                current_url=body.get("current_url", "")
            )
            return self._json({"ok": True})
        elif alert_type == "shopee_bridge":
            telegram_alerts.notify_shopee_bridge_disconnected()
            return self._json({"ok": True})
        elif alert_type == "member_joined":
            total_cust = 0
            try:
                with ledger.connect(self.cfg.db_path) as conn:
                    row = conn.execute("SELECT COUNT(*) FROM customers").fetchone()
                    if row:
                        total_cust = row[0]
            except Exception:
                pass
            telegram_alerts.notify_new_member_joined(
                display_name=body.get("display_name", "Thành viên mới"),
                member_rank=body.get("member_rank", 0),
                group_name=body.get("group_name", "Hoàn Tiền Shopee"),
                total_customers=total_cust,
                zalo_uid=body.get("zalo_uid", "")
            )
            return self._json({"ok": True})
        elif alert_type == "new_order":
            oid = body.get("order_id", "")
            if self.db_path and oid:
                try:
                    with ledger.connect(self.db_path) as conn:
                        if not ledger.should_notify_telegram_order(conn, oid, ledger.AWAITING_APPROVAL):
                            return self._json({"ok": True, "suppressed": True})
                        ledger.record_telegram_order_notified(conn, oid, ledger.AWAITING_APPROVAL)
                except Exception:
                    pass
            telegram_alerts.notify_new_order_received(
                order_id=oid,
                platform=body.get("platform", "shopee"),
                customer_id=body.get("customer_id"),
                customer_name=body.get("customer_name"),
                order_value=body.get("order_value"),
                estimated_commission=body.get("estimated_commission"),
                cashback_amount=body.get("cashback_amount"),
                order_time=body.get("order_time") or body.get("recorded_at"),
            )
            return self._json({"ok": True})
        elif alert_type == "order_approved":
            oid = body.get("order_id", "")
            if self.db_path and oid:
                try:
                    with ledger.connect(self.db_path) as conn:
                        if not ledger.should_notify_telegram_order(conn, oid, ledger.APPROVED):
                            return self._json({"ok": True, "suppressed": True})
                        ledger.record_telegram_order_notified(conn, oid, ledger.APPROVED)
                except Exception:
                    pass
            telegram_alerts.notify_order_approved(
                order_id=oid,
                platform=body.get("platform", "shopee"),
                customer_id=body.get("customer_id"),
                customer_name=body.get("customer_name"),
                order_value=body.get("order_value"),
                approved_commission=body.get("approved_commission"),
                cashback_amount=body.get("cashback_amount"),
                order_time=body.get("order_time") or body.get("recorded_at"),
            )
            return self._json({"ok": True})
        elif alert_type == "order_rejected":
            oid = body.get("order_id", "")
            if self.db_path and oid:
                try:
                    with ledger.connect(self.db_path) as conn:
                        if not ledger.should_notify_telegram_order(conn, oid, ledger.REJECTED):
                            return self._json({"ok": True, "suppressed": True})
                        ledger.record_telegram_order_notified(conn, oid, ledger.REJECTED)
                except Exception:
                    pass
            telegram_alerts.notify_order_rejected(
                order_id=oid,
                platform=body.get("platform", "shopee"),
                customer_id=body.get("customer_id"),
                customer_name=body.get("customer_name"),
                order_value=body.get("order_value"),
                reason=body.get("reason", "Bị hủy trong báo cáo đối soát"),
                order_time=body.get("order_time") or body.get("recorded_at"),
            )
            return self._json({"ok": True})
        elif alert_type == "order_paid":
            oid = body.get("order_id", "")
            if self.db_path and oid:
                try:
                    with ledger.connect(self.db_path) as conn:
                        if not ledger.should_notify_telegram_order(conn, oid, ledger.PAID):
                            return self._json({"ok": True, "suppressed": True})
                        ledger.record_telegram_order_notified(conn, oid, ledger.PAID)
                except Exception:
                    pass
            telegram_alerts.notify_order_paid(
                order_id=oid,
                platform=body.get("platform", "shopee"),
                customer_id=body.get("customer_id"),
                customer_name=body.get("customer_name"),
                cashback_amount=body.get("cashback_amount"),
                order_time=body.get("order_time") or body.get("recorded_at"),
                note=body.get("note", ""),
            )
            return self._json({"ok": True})
        elif alert_type == "bug_report":
            telegram_alerts.report_bug(
                title=body.get("title", "Lỗi phát sinh hệ thống"),
                details=body.get("details", ""),
                severity=body.get("severity", "HIGH"),
                source=body.get("source", "External / Worker"),
                error_trace=body.get("error_trace", ""),
                action_needed=body.get("action_needed", ""),
                fingerprint=body.get("fingerprint", ""),
                force=body.get("force", False),
            )
            return self._json({"ok": True})
        elif alert_type == "custom":
            telegram_alerts.send_alert(
                title=body.get("title", "Cảnh báo hệ thống"),
                details=body.get("details", ""),
                action_needed=body.get("action_needed", ""),
                alert_type=body.get("key", "generic_alert"),
                force=body.get("force", False)
            )
            return self._json({"ok": True})
        return self._json({"ok": False, "error": "unknown alert_type"}, 400)

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

    def _record_group_info(self):
        body = self._body()
        group_id = str(body.get("group_id") or "").strip()
        group_name = str(body.get("group_name") or "Hoàn Tiền Shopee").strip()
        total_members = int(body.get("total_members") or 33)
        if not group_id:
            return self._json({"ok": False, "message": "missing_group_id"}, 400)
        with ledger.connect(self.cfg.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS group_info (
                    group_id        TEXT PRIMARY KEY,
                    group_name      TEXT NOT NULL,
                    total_members   INTEGER NOT NULL,
                    updated_at      TEXT NOT NULL
                )
            """)
            conn.execute("""
                INSERT OR REPLACE INTO group_info (group_id, group_name, total_members, updated_at)
                VALUES (?, ?, ?, datetime('now'))
            """, (group_id, group_name, total_members))
            conn.commit()
        return self._json({"ok": True, "group_id": group_id, "group_name": group_name, "total_members": total_members})

    def _sync_group_members(self):
        body = self._body()
        group_id = str(body.get("group_id") or "2813090100064697955").strip()
        group_name = str(body.get("group_name") or "Hoàn Tiền Shopee").strip()
        members = body.get("members") or []
        if not group_id or not members:
            return self._json({"ok": False, "message": "missing_data"}, 400)

        with ledger.connect(self.cfg.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS group_info (
                    group_id        TEXT PRIMARY KEY,
                    group_name      TEXT NOT NULL,
                    total_members   INTEGER NOT NULL,
                    updated_at      TEXT NOT NULL
                )
            """)
            conn.execute("""
                INSERT OR REPLACE INTO group_info (group_id, group_name, total_members, updated_at)
                VALUES (?, ?, ?, datetime('now'))
            """, (group_id, group_name, len(members) + 1))

            synced_count = 0
            for m in members:
                uid = str(m.get("uid") or "").strip()
                name = str(m.get("name") or "").strip()
                if not uid:
                    continue

                found = ledger.find_customer_id(conn, uid)
                existing = (found,) if found else None

                if not existing:
                    conn.execute("""
                        INSERT INTO customers (customer_id, zalo_user_id, display_name, role, status, created_at)
                        VALUES (?, ?, ?, 'user', 'active', datetime('now'))
                    """, (uid, uid, name or f"Thành viên {uid[-4:]}"))
                    synced_count += 1
                elif name:
                    conn.execute("""
                        UPDATE customers 
                        SET display_name = COALESCE(NULLIF(display_name, ''), ?),
                            zalo_user_id = COALESCE(NULLIF(zalo_user_id, ''), ?)
                        WHERE customer_id = ?
                    """, (name, uid, existing[0]))

                act_exist = conn.execute(
                    "SELECT id FROM activity_logs WHERE customer_id = ? AND action = 'group_join'",
                    (uid,)
                ).fetchone()
                if not act_exist:
                    conn.execute("""
                        INSERT INTO activity_logs (customer_id, action, path, detail, created_at)
                        VALUES (?, 'group_join', ?, ?, datetime('now'))
                    """, (uid, f"zalo_group_{group_id}", json.dumps({"groupId": group_id, "groupName": group_name, "sync": True}, ensure_ascii=False)))

            conn.commit()

        return self._json({"ok": True, "synced_count": synced_count, "total": len(members)})

    def _bot_customer_auth(self):
        body = self._body()
        uid = str(body.get("uid") or "").strip()
        name = str(body.get("name") or "").strip()
        action = str(body.get("action") or "get_id").strip()
        if not uid:
            return self._json({"ok": False, "message": "missing_uid"}, 400)

        with ledger.connect(self.cfg.db_path) as conn:
            found = ledger.find_customer_id(conn, uid)
            row = ledger.get_customer(conn, found) if found else None
            if not row:
                conn.execute("""
                    INSERT INTO customers (customer_id, zalo_user_id, display_name, role, status, created_at)
                    VALUES (?, ?, ?, 'user', 'active', datetime('now'))
                """, (uid, uid, name or f"Thành viên {uid[-4:]}"))
                row = conn.execute("SELECT * FROM customers WHERE customer_id = ?", (uid,)).fetchone()
            elif name and not row["display_name"]:
                conn.execute("UPDATE customers SET display_name = ? WHERE customer_id = ?", (name, row["customer_id"]))
                row = conn.execute("SELECT * FROM customers WHERE customer_id = ?", (row["customer_id"],)).fetchone()

            cust_id = row["customer_id"]
            cust_code = row["customer_code"] or cust_id
            display_name = row["display_name"] or name or f"Thành viên {cust_id[-4:]}"

            if action == "issue_password":
                from ..core import accounts
                pwd = accounts.issue_password(conn, cust_id)
                conn.commit()
                return self._json({
                    "ok": True,
                    "customer_id": cust_id,
                    "customer_code": cust_code,
                    "display_name": display_name,
                    "password": pwd,
                })

            if action == "get_orders":
                from ..messaging import notifications
                in_group = bool(body.get("is_group", False))
                return self._json({
                    "ok": True,
                    "customer_id": cust_id,
                    "customer_code": cust_code,
                    "parts": notifications.order_history(
                        conn, cust_id, self.cfg.advertised_cashback_rate, in_group=in_group),
                })

            if action == "get_balance":
                from ..core import payouts
                rate = self.cfg.advertised_cashback_rate
                bal = payouts.balance_for(conn, cust_id, rate)
                return self._json({
                    "ok": True,
                    "customer_id": cust_id,
                    "customer_code": cust_code,
                    "display_name": display_name,
                    "approved": bal.approved,
                    "awaiting": bal.awaiting,
                    "paid": bal.paid,
                    "has_bank": bool(row["bank_account"]),
                    "bank_name": row["bank_name"],
                    "bank_account_tail": (row["bank_account"] or "")[-4:] if row["bank_account"] else None,
                })

            return self._json({
                "ok": True,
                "customer_id": cust_id,
                "customer_code": cust_code,
                "display_name": display_name,
                "has_password": bool(row["password_hash"]),
                "has_bank": bool(row["bank_account"]),
            })

    def _shopee_preview(self):
        from ..shopee.commission import lookup
        from ..shopee.dashboard_lookup import ANY_SHOPEE_URL

        from ..shopee.dashboard_lookup import ANY_SHOPEE_URL, parse_url, is_short_link, resolve_short_link

        body = self._body()
        raw_url = str(body.get("url") or "").strip()
        if any(d in raw_url.lower() for d in ("lazada.vn", "s.lazada.vn", "c.lazada.vn", "tiki.vn", "ti.ki")):
            return self._json({
                "ok": False,
                "error": "unsupported_platform",
                "message": "Hiện tại hệ thống chỉ hỗ trợ hoàn tiền cho các đơn hàng trên Shopee và TikTok Shop."
            }, 400)
        match = ANY_SHOPEE_URL.search(raw_url)
        if not match:
            from ..providers.registry import get_registry
            provider = get_registry().detect_provider(raw_url)
            if provider and provider.platform_name != "shopee":
                prev = provider.preview(raw_url, self.cfg.advertised_cashback_rate)
                if not prev:
                    return self._json({"ok": True, "found": False})
                return self._json({
                    "ok": True,
                    "found": True,
                    "name": prev.name,
                    "price": prev.price,
                    "price_formatted": prev.price_formatted,
                    "shopee_rate": 0.0,
                    "shopee_part": 0,
                    "shopee_part_formatted": "0đ",
                    "seller_rate": round(prev.commission_rate * 100, 1),
                    "seller_part": prev.raw_commission,
                    "seller_part_formatted": prev.commission_formatted,
                    "total_commission": prev.raw_commission,
                    "commission_formatted": prev.commission_formatted,
                    "is_capped": getattr(prev, "is_capped", False),
                    "cashback": prev.cashback_amount,
                    "cashback_formatted": prev.cashback_formatted,
                    "rate_percent": f"{self.cfg.advertised_cashback_rate:.0%}",
                    "platform": provider.platform_name,
                    "image_url": prev.image_url,
                })
            return self._json({"ok": False, "message": "invalid_url"}, 400)
        url = match.group(0)

        target_url = url
        if is_short_link(target_url):
            target_url = resolve_short_link(target_url)

        try:
            est = lookup(
                target_url,
                bridge=self.bridge,
                third_party=self.cfg.third_party_fallback,
                api_key=self.cfg.addlivetag_api_key,
            )
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
                    increment_count=False,
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
            "image_url": getattr(est, "image_url", "") or "",
        })

    def _requester(self, conn, body: dict) -> tuple[str | None, tuple | None]:
        """Who a link is for: (customer_id, None) or (None, (payload, status)).

        A signed-in customer is always themselves, whatever the form says.
        Otherwise the id must already belong to someone. Creating a link
        under another person's code gains nobody anything -- the money goes
        to the owner of the code -- so a code is enough, no password.

        Only the assistant, on loopback, may introduce a new customer: it
        has just seen that person on Zalo. The web has seen nobody, and an
        id typed there that matches no one would become a customer who can
        never be paid.
        """
        session = self._session_customer()
        if session:
            return session, None
        key = str(body.get("customer_id") or "").strip()
        if not key:
            if self.from_loopback:
                # The assistant always knows who wrote; no id is a bug there.
                return None, ({"ok": False, "error": "customer_id_required"}, 400)
            # A visitor who gave no code still gets a working link, under the
            # house account: the commission is ours rather than nobody's. The
            # response says house=True so the page can warn plainly that this
            # link earns the visitor nothing.
            return ledger.HOUSE_CUSTOMER_ID, None
        found = ledger.find_customer_id(conn, key)
        if found:
            return found, None
        if not self.from_loopback or ledger.looks_like_customer_code(key):
            return None, ({"ok": False, "error": "customer_not_found"}, 404)
        name = str(body.get("display_name") or "").strip()
        conn.execute(
            "INSERT INTO customers (customer_id, zalo_user_id, display_name,"
            " created_at, status) VALUES (?, ?, ?, ?, 'active')",
            (key, key, name or key, ledger.now()))
        conn.commit()
        return key, None

    def _channel(self, body: dict) -> str:
        """Where a request came from. Only the assistant may say; the queue
        serves Zalo first, so a web caller claiming Zalo would jump it."""
        claimed = str(body.get("channel") or "").strip() if self.from_loopback else ""
        return claimed or "web"

    def _web_link_budget(self, conn, customer_id: str, house: bool) -> tuple | None:
        """Refuse a NEW link from the internet past the web's share.

        Links already made are reused and never counted. The assistant is
        never limited: someone waiting in a Zalo chat always gets served.
        """
        if self.from_loopback:
            return None
        now_local = datetime.now(timezone.utc).astimezone()
        hour_ago = (now_local - timedelta(hours=1)).isoformat(timespec="seconds")
        recent = conn.execute(
            "SELECT COUNT(*) FROM link_requests WHERE channel='web' AND created_at >= ?",
            (hour_ago,)).fetchone()[0]
        if recent >= WEB_LINKS_PER_HOUR:
            return ({"ok": False, "error": "web_busy"}, 429)
        if not house:
            day_ago = (now_local - timedelta(days=1)).isoformat(timespec="seconds")
            mine = conn.execute(
                "SELECT COUNT(*) FROM link_requests WHERE channel='web'"
                " AND customer_id=? AND created_at >= ?",
                (customer_id, day_ago)).fetchone()[0]
            if mine >= WEB_LINKS_PER_CUSTOMER_PER_DAY:
                return ({"ok": False, "error": "web_busy"}, 429)
        return None

    def _shopee_convert(self):
        from ..core.identifiers import new_request_id
        from ..shopee.dashboard_lookup import ANY_SHOPEE_URL, parse_url, is_short_link, resolve_short_link
        from ..core import audit

        body = self._body()
        raw_url = str(body.get("url") or "").strip()
        if any(d in raw_url.lower() for d in ("lazada.vn", "s.lazada.vn", "c.lazada.vn", "tiki.vn", "ti.ki")):
            return self._json({
                "ok": False,
                "error": "unsupported_platform",
                "message": "Hiện tại hệ thống chỉ hỗ trợ hoàn tiền cho các đơn hàng trên Shopee và TikTok Shop."
            }, 400)
        match = ANY_SHOPEE_URL.search(raw_url)
        if not match:
            from ..providers.registry import get_registry
            provider = get_registry().detect_provider(raw_url)
            if provider and provider.platform_name != "shopee":
                with ledger.connect(self.cfg.db_path) as conn:
                    customer_id, refusal = self._requester(conn, body)
                    if refusal:
                        return self._json(refusal[0], refusal[1])
                    house = ledger.is_house(conn, customer_id)
                    budget = self._web_link_budget(conn, customer_id, house)
                    if budget:
                        return self._json(*budget)
                    req_id = new_request_id()
                    res = provider.create_link(raw_url, customer_id, req_id, conn, self.cfg.advertised_cashback_rate)
                    audit.record(audit.LINK_REQUESTED, customer_id=customer_id, request_id=res.request_id, url=raw_url, channel="web")
                    share = {}
                    if res.is_ready and res.affiliate_url and res.request_id:
                        ledger.mark_link_delivered(conn, res.request_id)
                        share = {"request_id": res.request_id}
                        self._add_share_url(conn, share)
                    conn.commit()
                if res.error:
                    is_no_aff = (res.error == "product_not_in_affiliate")
                    p_name = "TikTok Shop" if provider.platform_name == "tiktok" else ("Lazada" if provider.platform_name == "lazada" else "ShopeeFood")
                    return self._json({
                        "ok": False,
                        "ready": False,
                        "error": res.error,
                        "no_affiliate": is_no_aff,
                        "message": f"Sản phẩm này người bán không tham gia chương trình tiếp thị liên kết (Affiliate) trên {p_name}." if is_no_aff else res.error,
                    }, 200 if is_no_aff else 500)
                if res.is_ready and res.affiliate_url:
                    resp_data = {
                        "ok": True,
                        "ready": True,
                        "affiliate_url": res.affiliate_url,
                        "request_id": res.request_id,
                        "platform": provider.platform_name,
                        "cached": res.cached,
                        "house": house,
                    }
                    if share.get("share_url"):
                        resp_data["share_url"] = share["share_url"]
                    if res.product_preview:
                        prev = res.product_preview
                        resp_data.update({
                            "name": prev.name,
                            "price": prev.price,
                            "price_formatted": prev.price_formatted,
                            "shopee_rate": 0.0,
                            "seller_rate": round(prev.commission_rate * 100, 1),
                            "shopee_part": 0,
                            "shopee_part_formatted": "0đ",
                            "seller_part": prev.raw_commission,
                            "seller_part_formatted": prev.commission_formatted,
                            "total_commission": prev.raw_commission,
                            "commission_formatted": prev.commission_formatted,
                            "cashback": prev.cashback_amount,
                            "cashback_formatted": prev.cashback_formatted,
                            "rate_percent": f"{self.cfg.advertised_cashback_rate:.0%}",
                            "image_url": prev.image_url,
                            "found": True,
                        })
                    return self._json(resp_data)
                resp_not_ready = {
                    "ok": True,
                    "ready": False,
                    "request_id": res.request_id,
                    "platform": provider.platform_name,
                    "house": house,
                }
                if res.product_preview and res.product_preview.source_rate_info:
                    if res.product_preview.source_rate_info.get("is_group_order"):
                        resp_not_ready["is_group_order"] = True
                return self._json(resp_not_ready)
            return self._json({"ok": False, "error": "invalid_url"}, 400)
        url = match.group(0)

        target_url = url
        if is_short_link(target_url):
            target_url = resolve_short_link(target_url)

        with ledger.connect(self.cfg.db_path) as conn:
            customer_id, refusal = self._requester(conn, body)
            if refusal:
                return self._json(refusal[0], refusal[1])

            house = ledger.is_house(conn, customer_id)
            parsed = parse_url(target_url)
            item_id = parsed[2] if parsed else None

            # Reuse is by customer, never by product: see find_own_request.
            # The house account is the one exception: every guest is the same
            # payee, so one link per product serves them all, and a flood of
            # guests costs one trip to Shopee per product rather than per click.
            existing = None
            if house and item_id:
                existing = ledger.find_house_link(conn, item_id)
            if existing is None:
                existing = ledger.find_own_request(
                    conn, customer_id, (raw_url, url),
                    resend_within_days=self.cfg.link_attribution_days)
            if existing is not None and existing["affiliate_url"]:
                ledger.mark_link_delivered(conn, existing["request_id"])
                payload = {
                    "ok": True,
                    "ready": True,
                    "affiliate_url": existing["affiliate_url"],
                    "request_id": existing["request_id"],
                    "house": house,
                }
                self._add_share_url(conn, payload)
                conn.commit()
                return self._json(payload)

            if existing is not None:
                # Already being made: wait on that one, do not queue another.
                request_id = existing["request_id"]
            else:
                budget = self._web_link_budget(conn, customer_id, house)
                if budget:
                    return self._json(*budget)
                request_id = new_request_id()
                channel = self._channel(body)
                ledger.record_link_request(
                    conn,
                    request_id=request_id,
                    customer_id=customer_id,
                    source_url=url,
                    affiliate_url=None,
                    estimated_commission=None,
                    channel=channel,
                )
                if item_id:
                    # What find_house_link matches on, and how the console
                    # finds the picture for a short link.
                    conn.execute(
                        "UPDATE link_requests SET estimate_detail=? WHERE request_id=?",
                        (json.dumps({"item_id": str(item_id)}), request_id))
                audit.record(audit.LINK_REQUESTED, customer_id=customer_id,
                             request_id=request_id, url=url, channel=channel)
                conn.commit()

            # If products_cache already has this item, attach estimate_detail immediately
            if item_id:
                cached = ledger.get_product_cache(conn, item_id)
                if cached and cached["name"]:
                    detail_json = json.dumps({
                        "name": cached["name"],
                        "price": cached["price"] or 0,
                        "price_formatted": cached["price_formatted"] or _vnd(cached["price"] or 0),
                        "commission": cached["total_commission"] or 0,
                        "total_commission": cached["total_commission"] or 0,
                        "commission_formatted": cached["commission_formatted"] or _vnd(cached["total_commission"] or 0),
                        "shopee_rate": cached["shopee_rate"] or 0,
                        "seller_rate": cached["seller_rate"] or 0,
                        "shopee_part": cached["shopee_part"] or 0,
                        "shopee_part_formatted": cached["shopee_part_formatted"] or _vnd(cached["shopee_part"] or 0),
                        "seller_part": cached["seller_part"] or 0,
                        "seller_part_formatted": cached["seller_part_formatted"] or _vnd(cached["seller_part"] or 0),
                        "total_rate": (cached["shopee_rate"] or 0) + (cached["seller_rate"] or 0),
                        "is_capped": bool(cached["is_capped"]),
                        "cashback": cached["cashback"] or 0,
                        "cashback_formatted": cached["cashback_formatted"] or _vnd(cached["cashback"] or 0),
                        "rate_percent": cached["rate_percent"] or f"{self.cfg.advertised_cashback_rate:.0%}",
                        "source": "shopee",
                        "image_url": cached["image_url"] or "",
                        "item_id": str(item_id),
                    }, ensure_ascii=False)
                    conn.execute(
                        "UPDATE link_requests SET estimate_detail = ?, estimated_commission = COALESCE(estimated_commission, ?), estimate_source = COALESCE(estimate_source, 'shopee') WHERE request_id = ?",
                        (detail_json, cached["total_commission"], request_id),
                    )
                    conn.commit()

            req_row = conn.execute(
                "SELECT affiliate_url FROM link_requests WHERE request_id=?", (request_id,)
            ).fetchone()
            if req_row and req_row["affiliate_url"]:
                payload = {
                    "ok": True,
                    "ready": True,
                    "affiliate_url": req_row["affiliate_url"],
                    "request_id": request_id,
                    "house": house,
                }
                self._add_share_url(conn, payload)
                conn.commit()
                return self._json(payload)

            return self._json({
                "ok": True,
                "ready": False,
                "request_id": request_id,
                "house": house,
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
                "SELECT customer_id, affiliate_url, source_url, estimate_detail, status FROM link_requests WHERE request_id=?", (request_id,)
            ).fetchone()
            if not row:
                return self._json({"ok": False, "message": "not_found"}, 404)
            if row["status"] == "failed":
                return self._json({"ok": False, "ready": False, "failed": True, "error": "link_generation_failed"})
            if row["affiliate_url"]:
                src_url = row["source_url"]
                if is_short_link(src_url):
                    src_url = resolve_short_link(src_url)
                parsed = parse_url(src_url)
                if parsed:
                    cached = ledger.get_product_cache(conn, parsed[2])
                    if not cached or not cached.get("name") or not cached.get("price"):
                        try:
                            from ..shopee.commission import lookup
                            est = lookup(src_url, bridge=self.bridge, third_party=False)
                            if est and est.price > 0:
                                rate = self.cfg.advertised_cashback_rate
                                raw_comm = est.commission
                                net_comm = round_dong(raw_comm * (1 - 0.10 - 0.0098))
                                cb = round_dong(net_comm * rate)
                                cached = ledger.upsert_product_cache(
                                    conn,
                                    item_id=parsed[2],
                                    shop_id=parsed[1],
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
                                    canonical_url=src_url,
                                    image_url=getattr(est, "image_url", "") or "",
                                    increment_count=False,
                                )
                                conn.commit()
                        except Exception:
                            pass
                    if cached and cached["name"]:
                        detail_json = json.dumps({
                            "name": cached["name"],
                            "price": cached["price"] or 0,
                            "price_formatted": cached["price_formatted"] or _vnd(cached["price"] or 0),
                            "commission": cached["total_commission"] or 0,
                            "total_commission": cached["total_commission"] or 0,
                            "commission_formatted": cached["commission_formatted"] or _vnd(cached["total_commission"] or 0),
                            "shopee_rate": cached["shopee_rate"] or 0,
                            "seller_rate": cached["seller_rate"] or 0,
                            "shopee_part": cached["shopee_part"] or 0,
                            "shopee_part_formatted": cached["shopee_part_formatted"] or _vnd(cached["shopee_part"] or 0),
                            "seller_part": cached["seller_part"] or 0,
                            "seller_part_formatted": cached["seller_part_formatted"] or _vnd(cached["seller_part"] or 0),
                            "total_rate": (cached["shopee_rate"] or 0) + (cached["seller_rate"] or 0),
                            "is_capped": bool(cached["is_capped"]),
                            "cashback": cached["cashback"] or 0,
                            "cashback_formatted": cached["cashback_formatted"] or _vnd(cached["cashback"] or 0),
                            "rate_percent": cached["rate_percent"] or f"{self.cfg.advertised_cashback_rate:.0%}",
                            "source": "shopee",
                            "image_url": cached["image_url"] or "",
                            "item_id": str(parsed[2]),
                        }, ensure_ascii=False)
                        conn.execute(
                            "UPDATE link_requests SET estimate_detail = ?, estimated_commission = COALESCE(estimated_commission, ?), estimate_source = COALESCE(estimate_source, 'shopee') WHERE request_id = ? AND (estimate_detail IS NULL OR estimate_detail = '')",
                            (detail_json, cached["total_commission"], request_id),
                        )
                    conn.commit()
                # Whoever polls this shows the link to the customer.
                ledger.mark_link_delivered(conn, request_id)
                resp = {"ok": True, "ready": True, "affiliate_url": row["affiliate_url"],
                        "request_id": request_id,
                        "house": ledger.is_house(conn, row["customer_id"])}
                self._add_share_url(conn, resp)
                conn.commit()
                raw_detail = (locals().get("detail_json") if locals().get("detail_json") else None) or row["estimate_detail"]
                if raw_detail:
                    try:
                        detail = json.loads(raw_detail)
                        if "is_group_order" in detail:
                            resp["is_group_order"] = detail["is_group_order"]
                        for k in ("name", "price", "price_formatted", "shopee_rate", "seller_rate",
                                  "shopee_part", "shopee_part_formatted", "seller_part",
                                  "seller_part_formatted", "commission", "total_commission",
                                  "commission_formatted", "is_capped", "cashback",
                                  "cashback_formatted", "rate_percent", "image_url"):
                            if k in detail:
                                resp[k] = detail[k]
                    except Exception:
                        pass
                return self._json(resp)
        return self._json({"ok": True, "ready": False})

    def _add_share_url(self, conn, payload: dict) -> None:
        """Give a ready link its short address on our domain, for chat.

        The affiliate link stays in the payload: the web shows it as is
        (a visitor there is already in a real browser); the assistant
        sends share_url, which gets a Zalo user out of the in-app browser.
        """
        from ..ledger import share_links
        url = share_links.url_for(conn, self.cfg.public_base_url, payload.get("request_id") or "")
        if url:
            payload["share_url"] = url

    def _open_share_link(self, code: str, go: bool = False):
        """/s/<code>: the product page. /s/<code>/go: on to the affiliate link."""
        from ..ledger import campaigns, share_links
        from . import share_page

        agent_header = self.headers.get("User-Agent") or ""
        agent = share_page.classify(agent_header)
        with ledger.connect(self.cfg.db_path) as conn:
            row = share_links.find(conn, code)
            if row is None or not share_page.is_safe_target(row["affiliate_url"]):
                return self._send(404, share_page.render_not_found(labels()).encode("utf-8"),
                                  "text/html; charset=utf-8")
            # HEAD is something checking the link, not a person opening it.
            if not self._head_only:
                share_links.record_click(
                    conn, row["request_id"],
                    share_links.BUY if go and agent != share_links.AGENT_BOT else agent)
                conn.commit()
            if not go:
                product = self._share_product(conn, row)
                house = ledger.is_house(conn, row["customer_id"])
                offer = None if house else campaigns.offer_for(
                    conn, row["customer_id"], row["platform"] or "shopee")

        self._extra_headers = [("Cache-Control", "no-store"),
                               ("Referrer-Policy", "no-referrer-when-downgrade")]
        if go:
            self._extra_headers.append(("Location", row["affiliate_url"]))
            return self._send(302, b"", "text/plain; charset=utf-8")

        if offer:
            offer = {**offer, "bonus_formatted": _vnd(offer["bonus"])}
        words = labels()
        base = self.cfg.public_base_url or f"https://{self.headers.get('Host', '')}"
        page = share_page.render(
            words, page_url=f"{base.rstrip('/')}/s/{code}", target=row["affiliate_url"],
            platform=row["platform"], agent=agent, user_agent=agent_header,
            product=product, house=house, offer=offer,
            zalo_url=words.get("open_zalo_url", ""))
        return self._send(200, page.encode("utf-8"), "text/html; charset=utf-8")

    def _serve_bill(self, bill_id: str):
        """Public bill verification receipt: /b/<code>."""
        from datetime import datetime, timezone, timedelta
        import html
        vn_tz = timezone(timedelta(hours=7))

        with ledger.connect(self.cfg.db_path) as conn:
            row = conn.execute("""
                SELECT pt.*, c.display_name, c.customer_code, c.bank_name, c.bank_account, c.account_holder
                  FROM payment_transfers pt
                  JOIN customers c ON c.customer_id = pt.customer_id
                 WHERE pt.id = ? OR pt.transfer_code = ?
                 ORDER BY pt.id DESC LIMIT 1
            """, (bill_id, bill_id)).fetchone()

            if not row:
                err_html = """<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Biên lai không tồn tại - Hoàn Tiền DP</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #090d16; color: #f1f5f9; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 16px; }
    .card { background: #131b2e; border-radius: 18px; padding: 36px 24px; max-width: 420px; width: 100%; text-align: center; border: 1px solid #1e293b; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    h2 { color: #f87171; font-size: 20px; margin-bottom: 8px; }
    p { color: #94a3b8; font-size: 14px; margin-bottom: 20px; }
    a { display: inline-block; padding: 11px 24px; background: #10b981; color: white; text-decoration: none; border-radius: 10px; font-weight: 700; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Không tìm thấy biên lai</h2>
    <p>Biên lai thanh toán này không tồn tại hoặc đã được cập nhật.</p>
    <a href="/">Về trang chủ Hoàn Tiền DP</a>
  </div>
</body>
</html>"""
                return self._send(404, err_html.encode("utf-8"), "text/html; charset=utf-8")

            # Total received up to this transfer
            tot_row = conn.execute("""
                SELECT COALESCE(SUM(amount), 0) FROM payment_transfers
                 WHERE customer_id = ? AND id <= ?
            """, (row["customer_id"], row["id"])).fetchone()
            tot_val = tot_row[0] if tot_row else row["amount"]

            # Marked orders if available
            orders_info = []
            awards_map = {}
            total_bonus_in_transfer = 0
            camp_names_in_transfer = []
            if row["order_ids"]:
                oids = [o.strip() for o in row["order_ids"].split(",") if o.strip()]
                if oids:
                    marks = ",".join("?" * len(oids))
                    orders_info = conn.execute(f"""
                        SELECT o.order_id, o.order_value, o.cashback_amount, r.estimate_detail
                          FROM orders o
                          LEFT JOIN link_requests r ON r.request_id = o.request_id
                         WHERE o.order_id IN ({marks})
                    """, oids).fetchall()
                    aw_rows = conn.execute(f"""
                        SELECT a.order_id, a.amount, c.name as campaign_name
                          FROM campaign_awards a
                          LEFT JOIN campaigns c ON c.campaign_id = a.campaign_id
                         WHERE a.order_id IN ({marks}) AND a.status != 'void'
                    """, oids).fetchall()
                    for aw in aw_rows:
                        awards_map[aw["order_id"]] = aw
                        total_bonus_in_transfer += (aw["amount"] or 0)
                        if aw["campaign_name"]:
                            camp_names_in_transfer.append(aw["campaign_name"])

        created_str = row["created_at"] or ""
        try:
            dt = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
            vn_dt = dt.astimezone(vn_tz)
            created_fmt = vn_dt.strftime("%d/%m/%Y %H:%M")
        except Exception:
            created_fmt = created_str[:16]

        amount_fmt = _vnd(row["amount"])
        total_fmt = _vnd(tot_val)
        c_name = html.escape(row["display_name"] or "Khách hàng")
        c_code = html.escape(row["customer_code"] or row["customer_id"])
        bank_name = html.escape(row["bank_name"] or "")
        bank_acc = html.escape(row["bank_account"] or "")
        if len(bank_acc) > 4:
            bank_acc_masked = bank_acc[:2] + "****" + bank_acc[-4:]
        else:
            bank_acc_masked = bank_acc
        proof_raw = row["proof_image"] or ""
        transfer_code = html.escape(row["transfer_code"] or f"DP{row['id']:05d}")

        orders_html = ""
        if orders_info:
            rows_html = []
            for o in orders_info:
                oid = html.escape(o["order_id"])
                order_cb = o["cashback_amount"] or 0
                aw = awards_map.get(o["order_id"])
                bonus_amt = aw["amount"] if aw else 0
                camp_name = html.escape(aw["campaign_name"] or "Sự kiện") if aw else ""
                total_item = order_cb + bonus_amt

                p_name = ""
                try:
                    p_detail = json.loads(o["estimate_detail"] or "{}")
                    p_name = p_detail.get("name") or p_detail.get("title") or ""
                except Exception:
                    pass
                if not p_name:
                    p_name = f"Đơn #{oid}"
                p_name_esc = html.escape(p_name[:36] + ("..." if len(p_name) > 36 else ""))

                bonus_subline = f'<div style="font-size:11px;color:#f59e0b;font-weight:600;margin-top:2px;">🎁 Thưởng sự kiện: +{_vnd(bonus_amt)} <span style="font-size:10px;color:#94a3b8;font-weight:normal;">({camp_name})</span></div>' if bonus_amt > 0 else ''
                base_subline = f'<div style="font-size:10px;color:#64748b;">(Gốc: {_vnd(order_cb)})</div>' if bonus_amt > 0 else ''

                rows_html.append(f"""
                <div class="order-chip">
                  <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;color:#f1f5f9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{p_name_esc}</div>
                    <div style="font-size:11px;color:#64748b;margin-top:2px;">Mã: {oid}</div>
                    {bonus_subline}
                  </div>
                  <div style="text-align:right;white-space:nowrap;margin-left:12px;">
                    <div style="font-weight:700;color:#10b981;font-size:14px;">+{_vnd(total_item)}</div>
                    {base_subline}
                  </div>
                </div>""")

            bonus_badge_html = ""
            if total_bonus_in_transfer > 0:
                camps_str = html.escape(", ".join(list(dict.fromkeys(camp_names_in_transfer))))
                bonus_badge_html = f"""
                <div style="margin:10px 0 14px 0;padding:10px 14px;background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.3);border-radius:12px;display:flex;align-items:center;justify-content:space-between;">
                  <div style="display:flex;align-items:center;gap:8px;">
                    <span style="font-size:18px;">🎁</span>
                    <div>
                      <div style="font-size:12px;font-weight:700;color:#f59e0b;">Đã cộng thưởng sự kiện</div>
                      <div style="font-size:10px;color:#94a3b8;">{camps_str}</div>
                    </div>
                  </div>
                  <div style="font-weight:800;font-size:14px;color:#f59e0b;">+{_vnd(total_bonus_in_transfer)}</div>
                </div>"""

            orders_html = f"""
            <div class="orders-section">
              <div class="orders-title">
                <span>📦 Đơn hàng tất toán đợt này</span>
                <span>{len(orders_info)} đơn</span>
              </div>
              {bonus_badge_html}
              {''.join(rows_html)}
            </div>"""

        proof_html = ""
        if proof_raw:
            pinfo = _resolve_proof_urls(proof_raw)
            img_src = html.escape(pinfo["img_src"])
            link_href = html.escape(pinfo["link_href"])
            fallback_src = html.escape(pinfo["fallback_src"])
            file_id = pinfo["file_id"]

            if pinfo["is_gdrive"] and file_id:
                proxy_src = f"/proof/gdrive/{file_id}"
                onerror_attr = f' onerror="if(this.dataset.step===\'1\'){{this.dataset.step=\'2\';this.src=\'{proxy_src}\';}}else{{this.dataset.step=\'1\';this.src=\'{fallback_src}\';}}"'
                hint_text = "(Bấm vào ảnh để xem kích thước gốc trên Google Drive)"
            else:
                onerror_attr = ""
                hint_text = "(Bấm vào ảnh để phóng to)"

            proof_html = f"""
            <div class="proof-box">
              <div style="font-size:12px;color:#94a3b8;font-weight:600;">🧾 Ảnh biên lai chuyển khoản</div>
              <a href="{link_href}" target="_blank" rel="noopener">
                <img src="{img_src}"{onerror_attr} alt="Biên lai chuyển khoản" class="proof-img" />
              </a>
              <div style="font-size:11px;color:#64748b;margin-top:4px;">{hint_text}</div>
            </div>"""

        bank_row_html = f"""<div class="info-row">
        <span class="info-label">🏦 Ngân hàng</span>
        <span class="info-val">{bank_name} ({bank_acc_masked})</span>
      </div>""" if bank_name else ""

        page_html = f"""<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Biên Lai Chuyển Khoản #{transfer_code} - Hoàn Tiền DP</title>
  <meta name="robots" content="noindex, nofollow">
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #090d16;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
    }}
    .bill-card {{
      background: #131b2e;
      border: 1px solid #1e293b;
      border-radius: 24px;
      max-width: 460px;
      width: 100%;
      padding: 32px 24px;
      box-shadow: 0 20px 40px -15px rgba(0,0,0,0.6), 0 0 30px rgba(16,185,129,0.06);
      position: relative;
      overflow: hidden;
    }}
    .bill-card::before {{
      content: "";
      position: absolute;
      top: 0; left: 0; right: 0; height: 4px;
      background: linear-gradient(90deg, #10b981, #06b6d4, #3b82f6);
    }}
    .header {{ text-align: center; margin-bottom: 24px; }}
    .badge-icon {{
      width: 58px; height: 58px;
      background: rgba(16, 185, 129, 0.12);
      border: 2px solid rgba(16, 185, 129, 0.3);
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 12px;
      font-size: 26px;
    }}
    .status-text {{
      color: #10b981;
      font-weight: 700;
      font-size: 13px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      margin-bottom: 4px;
    }}
    .amount {{
      font-size: 34px;
      font-weight: 800;
      color: #ffffff;
      letter-spacing: -0.5px;
      margin: 4px 0 2px;
    }}
    .divider {{
      height: 1px;
      background: #1e293b;
      margin: 20px 0;
    }}
    .info-list {{ list-style: none; display: flex; flex-direction: column; gap: 12px; }}
    .info-row {{ display: flex; justify-content: space-between; align-items: flex-start; font-size: 13.5px; }}
    .info-label {{ color: #94a3b8; display: flex; align-items: center; gap: 6px; }}
    .info-val {{ color: #f8fafc; font-weight: 600; text-align: right; }}
    .highlight-val {{ color: #38bdf8; font-weight: 700; }}
    .proof-box {{
      margin-top: 16px;
      padding: 12px;
      background: #0b1120;
      border-radius: 12px;
      border: 1px dashed #334155;
      text-align: center;
    }}
    .proof-img {{
      max-width: 100%;
      border-radius: 8px;
      max-height: 240px;
      object-fit: contain;
      margin-top: 8px;
      cursor: pointer;
      border: 1px solid #1e293b;
    }}
    .orders-section {{
      margin-top: 18px;
      padding: 12px 14px;
      background: #0b1120;
      border-radius: 12px;
      font-size: 12.5px;
      border: 1px solid #1e293b;
    }}
    .orders-title {{ color: #94a3b8; font-weight: 600; margin-bottom: 10px; display: flex; justify-content: space-between; }}
    .order-chip {{ display: flex; justify-content: space-between; padding: 7px 0; border-bottom: 1px solid #1e293b; }}
    .order-chip:last-child {{ border-bottom: none; }}
    .footer-actions {{ margin-top: 24px; text-align: center; }}
    .btn-home {{
      display: block;
      width: 100%;
      padding: 12px;
      background: #10b981;
      color: #ffffff;
      text-decoration: none;
      border-radius: 12px;
      font-weight: 700;
      font-size: 14px;
      text-align: center;
    }}
    .btn-home:hover {{ background: #059669; }}
    .verified-mark {{
      margin-top: 16px;
      font-size: 11.5px;
      color: #64748b;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
    }}
  </style>
</head>
<body>
  <div class="bill-card">
    <div class="header">
      <div class="badge-icon">✅</div>
      <div class="status-text">Xác nhận thanh toán thành công</div>
      <div class="amount">+{amount_fmt}</div>
      <div style="font-size:12px;color:#94a3b8;">Hệ thống Hoàn Tiền DP • hoantiendp.com</div>
    </div>

    <div class="divider"></div>

    <div class="info-list">
      <div class="info-row">
        <span class="info-label">👤 Khách hàng</span>
        <span class="info-val">{c_name} <span style="color:#94a3b8;font-size:11.5px;">({c_code})</span></span>
      </div>
      <div class="info-row">
        <span class="info-label">📥 Tổng đã nhận</span>
        <span class="info-val highlight-val">{total_fmt}</span>
      </div>
      <div class="info-row">
        <span class="info-label">📅 Ngày chi trả</span>
        <span class="info-val">{created_fmt}</span>
      </div>
      {bank_row_html}
      <div class="info-row">
        <span class="info-label">🏷️ Mã giao dịch</span>
        <span class="info-val" style="font-family:monospace;color:#a5b4fc;">{transfer_code}</span>
      </div>
    </div>

    {proof_html}
    {orders_html}

    <div class="footer-actions">
      <a href="/" class="btn-home">Về trang chủ Hoàn Tiền DP</a>
      <div class="verified-mark">
        🛡️ Chứng từ giao dịch được xác thực bởi Hoàn Tiền DP
      </div>
    </div>
  </div>
</body>
</html>"""
        return self._send(200, page_html.encode("utf-8"), "text/html; charset=utf-8")

    def _public_gdrive_proof_proxy(self, file_id: str = ""):
        """Proxy Google Drive proof image with disk caching in uploads/proofs/."""
        if not file_id:
            qs = urllib.parse.urlparse(self.path).query
            params = urllib.parse.parse_qs(qs)
            file_id = (params.get("id") or [""])[0].strip()

        if not file_id or not re.match(r"^[a-zA-Z0-9_-]+$", file_id):
            return self._send(400, b"Invalid file id", "text/plain")

        cache_dir = PROJECT_ROOT / "uploads" / "proofs"
        cache_dir.mkdir(parents=True, exist_ok=True)
        cached_file = cache_dir / f"gdrive_{file_id}.jpg"
        if cached_file.exists() and cached_file.stat().st_size > 0:
            self._extra_headers = [
                ("Cache-Control", "public, max-age=604800, immutable"),
                ("Access-Control-Allow-Origin", "*"),
            ]
            return self._send(200, cached_file.read_bytes(), "image/jpeg")

        urls_to_try = [
            f"https://lh3.googleusercontent.com/d/{file_id}",
            f"https://drive.google.com/thumbnail?sz=w1200&id={file_id}",
            f"https://drive.google.com/uc?export=view&id={file_id}",
        ]
        import urllib.request
        for u in urls_to_try:
            try:
                req = urllib.request.Request(
                    u,
                    headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
                )
                with urllib.request.urlopen(req, timeout=12) as resp:
                    if resp.status == 200:
                        ct = resp.headers.get("Content-Type") or ""
                        if "image" in ct:
                            data = resp.read()
                            if len(data) > 0:
                                try:
                                    cached_file.write_bytes(data)
                                except Exception:
                                    pass
                                self._extra_headers = [
                                    ("Cache-Control", "public, max-age=604800, immutable"),
                                    ("Access-Control-Allow-Origin", "*"),
                                ]
                                return self._send(200, data, ct)
            except Exception:
                continue

        return self._send(404, b"Proof image not found", "text/plain")

    def _share_product(self, conn, row) -> dict:
        """Name, picture, price and cashback for a link's product page.

        The request's own breakdown first. A link handed out before the
        product was looked up has none, so fall back to the product cache
        (resolving a short source link once) and keep what was found on the
        request, so the next visit is a plain read.
        """
        try:
            product = json.loads(row["estimate_detail"] or "{}")
        except ValueError:
            product = {}
        if not isinstance(product, dict):
            product = {}
        if product.get("name") and (product.get("price") or product.get("cashback")):
            return self._format_product(product)
        if (row["platform"] or "shopee") != "shopee":
            return self._format_product(product)

        from ..shopee.dashboard_lookup import parse_url, is_short_link, resolve_short_link
        source = row["source_url"] or ""
        try:
            if is_short_link(source):
                source = resolve_short_link(source)
            parsed = parse_url(source)
        except Exception:
            parsed = None
        cached = ledger.get_product_cache(conn, parsed[2]) if parsed else None
        if not cached or not cached["name"]:
            return self._format_product(product)
        found = {
            "name": cached["name"], "price": cached["price"] or 0,
            "price_formatted": cached["price_formatted"] or "",
            "shopee_rate": cached["shopee_rate"] or 0, "seller_rate": cached["seller_rate"] or 0,
            "shopee_part": cached["shopee_part"] or 0,
            "shopee_part_formatted": cached["shopee_part_formatted"] or "",
            "seller_part": cached["seller_part"] or 0,
            "seller_part_formatted": cached["seller_part_formatted"] or "",
            "commission": cached["total_commission"] or 0,
            "total_commission": cached["total_commission"] or 0,
            "is_capped": bool(cached["is_capped"]),
            "cashback": cached["cashback"] or 0,
            "cashback_formatted": cached["cashback_formatted"] or "",
            "rate_percent": cached["rate_percent"] or f"{self.cfg.advertised_cashback_rate:.0%}",
            "image_url": cached["image_url"] or "", "source": "shopee",
            "item_id": str(parsed[2]),
        }
        merged = {**found, **{k: v for k, v in product.items() if v}}
        conn.execute("UPDATE link_requests SET estimate_detail=? WHERE request_id=?",
                     (json.dumps(merged, ensure_ascii=False), row["request_id"]))
        conn.commit()
        return self._format_product(merged)

    def _format_product(self, product: dict) -> dict:
        """Fill in the money strings a stored breakdown may lack."""
        out = dict(product)
        for amount, text in (("price", "price_formatted"), ("cashback", "cashback_formatted"),
                             ("shopee_part", "shopee_part_formatted"),
                             ("seller_part", "seller_part_formatted")):
            if out.get(amount) and not out.get(text):
                out[text] = _vnd(out[amount])
        out.setdefault("rate_percent", f"{self.cfg.advertised_cashback_rate:.0%}")
        return out

    def _shopee_smart_resolve(self):
        """Unified Smart Resolve: 12h on-demand cache refresh + instant affiliate URL reuse."""
        from ..shopee.commission import lookup
        from ..shopee.dashboard_lookup import ANY_SHOPEE_URL, parse_url, is_short_link, resolve_short_link

        body = self._body()
        raw_url = str(body.get("url") or "").strip()
        if any(d in raw_url.lower() for d in ("lazada.vn", "s.lazada.vn", "c.lazada.vn", "tiki.vn", "ti.ki")):
            return self._json({
                "ok": False,
                "error": "unsupported_platform",
                "message": "Hiện tại hệ thống chỉ hỗ trợ hoàn tiền cho các đơn hàng trên Shopee và TikTok Shop."
            }, 400)
        customer_id = self._session_customer() or str(body.get("customer_id") or "").strip()
        channel = str(body.get("channel") or "zalo").strip()
        max_age_hours = float(body.get("max_age_hours") or 12.0)

        match = ANY_SHOPEE_URL.search(raw_url)
        if not match:
            from ..providers.registry import get_registry
            provider = get_registry().detect_provider(raw_url)
            if provider:
                return self._shopee_convert()
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
                customer_id, refusal = self._requester(conn, body)
                if refusal:
                    return self._json(refusal[0], refusal[1])

            rate = self.cfg.advertised_cashback_rate
            cached_row = ledger.get_product_cache(conn, item_id) if item_id else None

            # Product facts (price, commission) are shared across customers;
            # the link is not. Its sub_id1 names the customer it was made
            # for and reconciliation credits every order on it to them, so a
            # link found by product would pay someone else for this
            # customer's purchase. Only this customer's own link is reused.
            own = ledger.find_own_request(
                conn, customer_id, (raw_url, url),
                resend_within_days=self.cfg.link_attribution_days,
            ) if customer_id else None

            if cached_row and own is not None and own["affiliate_url"]:
                try:
                    updated_dt = datetime.fromisoformat(cached_row["updated_at"])
                    age_hours = (datetime.now(timezone.utc).astimezone()
                                 - updated_dt).total_seconds() / 3600.0
                except Exception:
                    age_hours = 999.0

                if age_hours < max_age_hours and cached_row["price"] and cached_row["price"] > 0:
                    conn.execute(
                        "UPDATE products_cache SET request_count = request_count + 1 WHERE item_id = ?",
                        (item_id,),
                    )
                    ledger.mark_link_delivered(conn, own["request_id"])
                    payload = _cache_payload(
                        cached_row, own, rate, source="cache_instant",
                        age_hours=round(age_hours, 1))
                    self._add_share_url(conn, payload)
                    conn.commit()
                    return self._json(payload)

                # Stale numbers: refresh price and commission, keep the link.
                try:
                    est = lookup(
                        target_url,
                        bridge=self.bridge,
                        third_party=self.cfg.third_party_fallback,
                        api_key=self.cfg.addlivetag_api_key,
                    )
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
                        canonical_url=target_url,
                        image_url=getattr(est, "image_url", "") or "",
                        increment_count=True,
                    )
                    ledger.mark_link_delivered(conn, own["request_id"])
                    payload = _cache_payload(
                        new_cached, own, rate, source="cache_refreshed",
                        age_hours=0.0)
                    self._add_share_url(conn, payload)
                    conn.commit()
                    return self._json(payload)

        # No link of this customer's own yet: make one for them.
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
                    est = lookup(
                        target_url,
                        bridge=self.bridge,
                        third_party=self.cfg.third_party_fallback,
                        api_key=self.cfg.addlivetag_api_key,
                    )
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
                            increment_count=False,
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


    def _tiktok_topdeal(self):
        """Return top TikTok Shop products from AccessTrade product feed."""
        from ..providers.registry import get_registry
        from urllib.parse import parse_qs, urlparse

        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        keyword = qs.get("q", [""])[0].strip()
        limit = min(int(qs.get("limit", ["5"])[0]), 20)

        registry = get_registry()
        tiktok_provider = registry.get_by_name("tiktok")

        if tiktok_provider is None or not tiktok_provider.is_configured:
            return self._json({"ok": False, "message": "TikTok provider not configured", "products": []})

        products = tiktok_provider.search_products(keyword=keyword, limit=limit)
        return self._json({"ok": True, "products": products})

    def _deals(self):
        """Return curated high-cashback featured deals, optionally filtered by category."""
        from urllib.parse import parse_qs, urlparse
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        cat = qs.get("category", ["all"])[0].strip()
        with ledger.connect(self.cfg.db_path) as conn:
            deals = ledger.get_dynamic_featured_deals(conn, category=cat, limit=24)
            return self._json({"ok": True, "deals": deals})

    def _fnb_vouchers(self):
        """Return F&B vouchers (Highlands, The Coffee House), optionally filtered by brand and type."""
        from urllib.parse import parse_qs, urlparse
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        brand = (qs.get("brand") or [None])[0]
        v_type = (qs.get("type") or [None])[0]
        with ledger.connect(self.cfg.db_path) as conn:
            ledger.seed_fnb_vouchers_if_empty(conn)
            rows = ledger.get_fnb_vouchers(conn, brand=brand, voucher_type=v_type, only_active=True)
            vouchers = []
            for r in rows:
                vouchers.append({
                    "id": r["id"],
                    "brand": r["brand"],
                    "title": r["title"],
                    "description": r["description"] or "",
                    "voucherType": r["voucher_type"],
                    "code": r["code"] or "",
                    "barcodeUrl": r["barcode_url"] or "",
                    "affiliateUrl": r["affiliate_url"] or "",
                    "discountText": r["discount_text"] or "",
                    "minOrder": r["min_order"] or 0,
                    "minOrderFormatted": _vnd(r["min_order"] or 0),
                    "startDate": r["start_date"] or "",
                    "endDate": r["end_date"] or "",
                    "isHot": bool(r["is_hot"]),
                })
            return self._json({"ok": True, "vouchers": vouchers})

    def _fnb_deals_of_the_day(self):
        """Return top hot F&B deals for broadcast or highlight banners."""
        with ledger.connect(self.cfg.db_path) as conn:
            ledger.seed_fnb_vouchers_if_empty(conn)
            rows = conn.execute(
                "SELECT * FROM fnb_vouchers WHERE is_active = 1 AND is_hot = 1 ORDER BY brand ASC, id ASC"
            ).fetchall()
            deals = []
            for r in rows:
                deals.append({
                    "id": r["id"],
                    "brand": r["brand"],
                    "title": r["title"],
                    "description": r["description"] or "",
                    "code": r["code"] or "",
                    "discountText": r["discount_text"] or "",
                    "affiliateUrl": r["affiliate_url"] or "",
                })
            return self._json({"ok": True, "deals": deals})

    def _fnb_link(self):
        """Generate a personalized affiliate link for Highlands Coffee or The Coffee House."""
        from urllib.parse import parse_qs, urlparse
        from ..providers.fnb_provider import create_fnb_link

        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        brand = (qs.get("brand") or ["highlands"])[0]
        customer_id = (qs.get("customer_id") or [""])[0]
        request_id = (qs.get("request_id") or [""])[0] or None

        res = create_fnb_link(
            api_key=self.cfg.accesstrade_api_key,
            brand=brand,
            customer_id=customer_id,
            request_id=request_id,
            base_url=self.cfg.accesstrade_base_url,
        )
        return self._json(res)

    def _admin_upsert_fnb_voucher(self):
        """Admin endpoint to add or update an F&B voucher."""
        body = self._body()
        brand = str(body.get("brand") or "").strip().lower()
        title = str(body.get("title") or "").strip()
        if not brand or not title:
            return self._json({"ok": False, "message": "missing_fields"}, 400)
        with ledger.connect(self.cfg.db_path) as conn:
            v_id = ledger.upsert_fnb_voucher(
                conn,
                brand=brand,
                title=title,
                description=str(body.get("description") or "").strip(),
                voucher_type=str(body.get("voucher_type") or "counter").strip().lower(),
                code=str(body.get("code") or "").strip().upper(),
                barcode_url=str(body.get("barcode_url") or "").strip(),
                affiliate_url=str(body.get("affiliate_url") or "").strip(),
                discount_text=str(body.get("discount_text") or "").strip(),
                min_order=int(body.get("min_order") or 0),
                start_date=str(body.get("start_date") or "").strip(),
                end_date=str(body.get("end_date") or "").strip(),
                is_hot=1 if body.get("is_hot") else 0,
                is_active=1 if body.get("is_active", True) else 0,
                voucher_id=body.get("id"),
            )
            conn.commit()
            return self._json({"ok": True, "voucher_id": v_id})

    MAX_BODY_BYTES = 65_536  # 64 KB limit to prevent memory exhaustion / DoS


    def _body(self, max_bytes: int = MAX_BODY_BYTES) -> dict:
        if hasattr(self, "_cached_body"):
            return self._cached_body
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if not length:
                self._cached_body = {}
                return self._cached_body
            if length > max_bytes:
                _log.warning("Request body too large: %d bytes (limit: %d)", length, max_bytes)
                self._cached_body = {}
                return self._cached_body
            raw_bytes = self.rfile.read(length)
            self._cached_body = json.loads(raw_bytes.decode("utf-8")) or {}
            return self._cached_body
        except (ValueError, TypeError, UnicodeDecodeError) as e:
            _log.warning("Failed to parse request JSON body: %s", e)
            self._cached_body = {}
            return self._cached_body

    def _raw_body(self, max_bytes: int = 1_048_576) -> bytes:
        if hasattr(self, "_cached_raw_body"):
            return self._cached_raw_body
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if not length or length > max_bytes:
                self._cached_raw_body = b""
                return self._cached_raw_body
            self._cached_raw_body = self.rfile.read(length)
            return self._cached_raw_body
        except Exception:
            self._cached_raw_body = b""
            return self._cached_raw_body

    def _handle_deploy_webhook(self):
        secret = os.getenv("DEPLOY_WEBHOOK_SECRET", "hoantiendp_ci_cd_secret_2026").strip()
        hub_sig = self.headers.get("X-Hub-Signature-256", "").strip()
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        query_secret = (query.get("secret") or [""])[0].strip()

        raw = self._raw_body()

        valid = False
        if hub_sig and secret:
            expected = "sha256=" + hmac.new(secret.encode("utf-8"), raw, hashlib.sha256).hexdigest()
            valid = hmac.compare_digest(hub_sig, expected)
        elif query_secret and secret:
            valid = hmac.compare_digest(query_secret, secret)
        elif not secret:
            valid = True

        if not valid:
            _log.warning("Deploy webhook received with invalid secret / signature.")
            return self._json({"ok": False, "error": "invalid_secret"}, 401)

        event = self.headers.get("X-GitHub-Event", "push")
        if event == "ping":
            return self._json({"ok": True, "message": "pong"})

        try:
            payload = json.loads(raw.decode("utf-8")) if raw else {}
        except Exception:
            payload = {}

        ref = payload.get("ref", "")
        if ref and ref != "refs/heads/main":
            return self._json({"ok": True, "message": f"ignored_branch_{ref}"})

        head_commit = payload.get("head_commit") or {}
        commit_sha = (head_commit.get("id") or payload.get("after") or "latest")[:7]
        commit_msg = (head_commit.get("message") or "Deploy trigger").split("\n")[0]
        author = (head_commit.get("author") or {}).get("name", "Git User")

        threading.Thread(
            target=self._run_git_deploy,
            args=(commit_sha, commit_msg, author),
            daemon=True,
        ).start()

        return self._json({"ok": True, "status": "deploying", "commit": commit_sha})

    @staticmethod
    def _run_git_deploy(commit_sha: str, commit_msg: str, author: str) -> None:
        from ..core import telegram_alerts
        time_str = datetime.now().strftime("%H:%M:%S - %d/%m/%Y")
        _log.info("CI/CD Webhook: Starting automatic git pull for commit %s by %s...", commit_sha, author)

        try:
            pull_res = subprocess.run(
                ["git", "pull", "origin", "main"],
                cwd=str(PROJECT_ROOT),
                capture_output=True,
                text=True,
                timeout=90,
            )
            if pull_res.returncode != 0:
                err = pull_res.stderr.strip() or pull_res.stdout.strip()
                _log.error("CI/CD git pull failed: %s", err)
                telegram_alerts.report_bug(
                    title=f"CI/CD Git Pull Thất Bại (Commit {commit_sha})",
                    details=f"Lệnh git pull origin main trả về mã lỗi {pull_res.returncode}:\n{err}",
                    severity="HIGH",
                    source="ci_cd.webhook",
                    action_needed="Kiểm tra xung đột file hoặc token Git trên VPS.",
                )
                return
        except Exception as exc:
            _log.exception("CI/CD exception during git pull: %s", exc)
            telegram_alerts.report_bug(
                title=f"CI/CD Lỗi Ngoại Lệ Khi Kéo Code (Commit {commit_sha})",
                details=str(exc),
                severity="HIGH",
                source="ci_cd.webhook",
            )
            return

        # Run uv sync
        try:
            subprocess.run(
                ["uv", "sync"],
                cwd=str(PROJECT_ROOT),
                capture_output=True,
                text=True,
                timeout=120,
            )
        except Exception as exc:
            _log.warning("CI/CD uv sync note: %s", exc)

        # Notify Dev DP group
        msg = (
            f"🚀 <b>[CI/CD AUTO DEPLOY THÀNH CÔNG]</b>\n\n"
            f"📦 <b>Nhánh:</b> <code>main</code>\n"
            f"📝 <b>Commit:</b> <code>{commit_sha}</code> - {commit_msg}\n"
            f"👤 <b>Tác giả:</b> {author}\n"
            f"⏱ <b>Thời gian:</b> <code>{time_str}</code>\n\n"
            f"✅ <i>Mã nguồn trên VPS đã được tự động kéo mới nhất và đồng bộ!</i>\n"
            f"🔄 <i>Đang khởi động lại Backend & Assistant để cập nhật logic mới...</i>"
        )
        telegram_alerts.send_telegram_message(msg)

        # Restart backend & assistant with updated code
        def _do_restart():
            import time
            time.sleep(2)
            restart_script = PROJECT_ROOT / "scripts" / "start-all.ps1"
            if restart_script.exists():
                _log.info("CI/CD: Restarting backend and assistant via start-all.ps1 -CodeOnly...")
                subprocess.Popen(
                    ["powershell.exe", "-ExecutionPolicy", "Bypass", "-File", str(restart_script), "-CodeOnly"],
                    creationflags=subprocess.CREATE_NEW_CONSOLE if hasattr(subprocess, "CREATE_NEW_CONSOLE") else 0
                )

        threading.Thread(target=_do_restart, daemon=False).start()


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


def serve(cfg: Config, port: int | None = None) -> None:
    port = cfg.dashboard_port if port is None else port
    handler = type("DashboardHandler", (_Handler,), {"cfg": cfg})
    server = _create_server(port, handler) or ThreadingHTTPServer(("127.0.0.1", port), handler)
    print(f"Dashboard on http://127.0.0.1:{port}")
    public = cfg.public_port
    if public and port not in (0, public):
        extra = _create_server(public, handler)
        if extra is not None:
            threading.Thread(target=extra.serve_forever, daemon=True).start()
            print(f"Also listening on port {public} for Cloudflare Tunnel")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


def serve_in_background(cfg: Config, port: int | None = None) -> ThreadingHTTPServer:
    port = cfg.dashboard_port if port is None else port
    handler = type("DashboardHandler", (_Handler,), {"cfg": cfg})
    server = _create_server(port, handler) or ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    # The tunnel points at PUBLIC_PORT (80 in production, 0 to skip it).
    public = cfg.public_port
    if public and port not in (0, public):
        extra = _create_server(public, handler)
        if extra is not None:
            threading.Thread(target=extra.serve_forever, daemon=True).start()

    return server
