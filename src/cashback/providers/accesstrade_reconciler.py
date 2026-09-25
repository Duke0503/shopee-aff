"""AccessTrade Order Reconciliation module.

Polls AccessTrade Orders API (or processes webhooks) to synchronize
TikTok Shop affiliate conversion orders and settle customer cashback.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Any, Optional

import httpx

from .base import NormalizedOrder
from .tiktok_provider import TikTokAccessTradeProvider
from ..core.config import Config
from ..core.policy import round_dong
from ..ledger import repository as ledger

log = logging.getLogger(__name__)


@dataclass
class ReconcileSummary:
    rows_read: int = 0
    orders_new: int = 0
    approved: int = 0
    rejected: int = 0
    skipped: int = 0
    needs_review: int = 0
    error: Optional[str] = None


def fetch_accesstrade_orders(
    api_key: str,
    base_url: str = "https://api.accesstrade.vn",
    since_days: int = 30,
    timeout: float = 15.0,
    max_pages: int = 5,
) -> list[dict[str, Any]]:
    """Fetch recent orders from AccessTrade Orders API (v1/order-list with fallback)."""
    if not api_key:
        return []

    auth_header = api_key if api_key.startswith("Token ") else f"Token {api_key}"
    headers = {
        "Authorization": auth_header,
        "Content-Type": "application/json",
        "User-Agent": "CashbackBot/1.0",
    }

    now = datetime.now(timezone.utc)
    since_dt = now - timedelta(days=since_days)
    since_iso = since_dt.strftime("%Y-%m-%dT00:00:00Z")
    until_iso = now.strftime("%Y-%m-%dT23:59:59Z")

    # Try official v1/order-list first, then fallback to v1/orders
    endpoints_to_try = [
        f"{base_url.rstrip('/')}/v1/order-list",
        f"{base_url.rstrip('/')}/v1/orders",
    ]

    all_orders: list[dict[str, Any]] = []

    with httpx.Client(timeout=timeout) as client:
        for endpoint in endpoints_to_try:
            try:
                page = 1
                while page <= max_pages:
                    params: dict[str, Any] = {
                        "since": since_iso,
                        "until": until_iso,
                        "limit": 300,
                        "page": page,
                    }
                    resp = client.get(endpoint, headers=headers, params=params)
                    if resp.status_code == 404:
                        break
                    resp.raise_for_status()
                    data = resp.json()

                    batch: list[dict[str, Any]] = []
                    total = 0
                    if isinstance(data, dict):
                        batch = data.get("data") or data.get("orders") or []
                        total = int(data.get("total") or len(batch))
                    elif isinstance(data, list):
                        batch = data
                        total = len(batch)

                    all_orders.extend(batch)

                    if not batch or len(all_orders) >= total or len(batch) < 300:
                        break
                    page += 1

                if all_orders or resp.status_code == 200:
                    return all_orders
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 404:
                    continue
                log.error(f"AccessTrade API error at {endpoint}: {exc}")
                raise
            except Exception as exc:
                log.error(f"Failed to fetch orders from AccessTrade at {endpoint}: {exc}")
                raise

    return all_orders


def fetch_accesstrade_transactions(
    api_key: str,
    base_url: str = "https://api.accesstrade.vn",
    since_days: int = 30,
    timeout: float = 20.0,
    max_pages: int = 10,
) -> list[dict[str, Any]]:
    """Commission lines from /v1/transactions.

    This, not /v1/order-list, is the endpoint that returns the sub ids a link
    was created with (under _extra.sub_params). order-list has neither the
    customer nor a status, so an order read from it can never be attributed
    to anyone nor ever become approved. The range stays within 30 days: a
    60-day window answered 500.
    """
    if not api_key:
        return []
    headers = {"Authorization": api_key if api_key.startswith("Token ") else f"Token {api_key}"}
    now = datetime.now(timezone.utc)
    params: dict[str, Any] = {
        "since": (now - timedelta(days=min(since_days, 30))).strftime("%Y-%m-%dT00:00:00Z"),
        "until": now.strftime("%Y-%m-%dT23:59:59Z"),
        "limit": 100,
    }
    rows: list[dict[str, Any]] = []
    with httpx.Client(timeout=timeout) as client:
        for page in range(1, max_pages + 1):
            resp = client.get(f"{base_url.rstrip('/')}/v1/transactions",
                              headers=headers, params={**params, "page": page})
            resp.raise_for_status()
            data = resp.json()
            batch = (data.get("data") if isinstance(data, dict) else data) or []
            rows.extend(batch)
            total = int(data.get("total") or 0) if isinstance(data, dict) else len(rows)
            if not batch or len(rows) >= total:
                break
    return rows


def normalize_transactions(rows: list[dict[str, Any]]) -> list[NormalizedOrder]:
    """One order per transaction_id, from its commission lines.

    TikTok reports an order as several lines -- the product, and often a
    brand bonus -- and a customer looking at them sees "two orders". They
    are one purchase: values and commissions are summed. An order counts
    as approved only once AccessTrade has confirmed every line that was
    not rejected; until then the commission is an estimate, never paid.
    """
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        order_id = str(row.get("transaction_id") or row.get("order_id") or "").strip()
        if order_id:
            grouped.setdefault(order_id, []).append(row)

    orders = []
    for order_id, lines in grouped.items():
        subs: dict[str, Any] = {}
        for line in lines:
            subs = ((line.get("_extra") or {}).get("sub_params") or {}) or subs
        customer_id = str(subs.get("sub1") or lines[0].get("sub1") or "").strip()
        request_id = str(subs.get("sub2") or lines[0].get("sub2") or "").strip() or None

        def amount(line, key):
            try:
                return float(line.get(key) or 0)
            except (TypeError, ValueError):
                return 0.0

        value = sum(amount(l, "product_price") * (int(l.get("product_quantity") or 1)) for l in lines)
        commission = sum(amount(l, "commission") for l in lines)
        statuses = [int(l.get("status") or 0) for l in lines]
        live = [l for l, st in zip(lines, statuses) if st != 2]

        if not live:
            status, approved = "rejected", None
        elif all(int(l.get("status") or 0) == 1 and int(l.get("is_confirmed") or 0) == 1 for l in live):
            status = "approved"
            approved = round(sum(amount(l, "commission") for l in live))
        else:
            status, approved = "awaiting_approval", None

        reason = next((l.get("reason_rejected") for l in lines if l.get("reason_rejected")), None)
        orders.append(NormalizedOrder(
            order_id=order_id,
            platform="tiktok",
            customer_id=customer_id,
            request_id=request_id,
            order_value=round(value),
            estimated_commission=round(commission),
            approved_commission=approved,
            status=status,
            rejection_reason=reason,
            order_time=str(lines[0].get("transaction_time") or ""),
        ))
    return orders


def _flag_once(conn, order_id: str, raw: Any, reason: str) -> None:
    """Every sync sees the same order again; one open review is enough."""
    if conn.execute(
        "SELECT 1 FROM manual_review WHERE order_id=? AND resolved=0 AND reason=?",
        (order_id, reason)).fetchone():
        return
    ledger.flag_for_review(conn, order_id, json.dumps(raw, ensure_ascii=False, default=str), reason)


def sync_accesstrade_orders(
    cfg: Config,
    raw_orders: Optional[list[dict[str, Any]]] = None,
    since_days: int = 30,
    transactions: Optional[list[dict[str, Any]]] = None,
) -> ReconcileSummary:
    """Synchronize AccessTrade orders into the ledger."""
    summary = ReconcileSummary()
    provider = TikTokAccessTradeProvider(
        api_key=cfg.accesstrade_api_key,
        base_url=cfg.accesstrade_base_url,
    )

    if raw_orders is not None:
        normalized_orders = provider.parse_orders(raw_orders)
    else:
        if transactions is None:
            if not cfg.accesstrade_api_key:
                summary.error = "ACCESSTRADE_API_KEY is not configured"
                return summary
            try:
                transactions = fetch_accesstrade_transactions(
                    api_key=cfg.accesstrade_api_key,
                    base_url=cfg.accesstrade_base_url,
                    since_days=since_days,
                )
            except Exception as exc:
                summary.error = str(exc)
                return summary
        normalized_orders = normalize_transactions(transactions)
    summary.rows_read = len(normalized_orders)

    with ledger.connect(cfg.db_path) as conn:
        for order in normalized_orders:
            existing = ledger.get_order(conn, order.order_id)
            if not existing:
                # Never guess. An order that cannot be tied to a customer --
                # no sub1, or one matching nobody -- goes to a human rather
                # than into the ledger under nobody, or under a made-up
                # customer who could never be paid.
                valid_cust_id = ledger.find_customer_id(conn, order.customer_id) if order.customer_id else None
                if valid_cust_id is None:
                    _flag_once(conn, order.order_id, order.__dict__,
                               "tiktok order without a known customer (sub1)")
                    summary.needs_review += 1
                    continue

                valid_req_id = None
                if order.request_id:
                    req_row = conn.execute(
                        "SELECT request_id FROM link_requests WHERE request_id = ?",
                        (order.request_id,),
                    ).fetchone()
                    if req_row:
                        valid_req_id = req_row["request_id"]

                ledger.add_order(
                    conn,
                    order_id=order.order_id,
                    customer_id=valid_cust_id,
                    request_id=valid_req_id,
                    order_value=order.order_value,
                    estimated_commission=order.estimated_commission,
                    platform="tiktok",
                )
                summary.orders_new += 1
                existing = ledger.get_order(conn, order.order_id)

            if not existing:
                summary.skipped += 1
                continue

            # Don't modify already paid orders
            if existing["paid_at"]:
                summary.skipped += 1
                continue

            current_status = existing["status"]

            if order.status == "approved" and current_status != "approved":
                approved_comm = order.approved_commission or order.estimated_commission
                # 10% PIT tax withheld at source for individual affiliate
                net_comm = round_dong(approved_comm * (1 - 0.10))
                cashback = round_dong(net_comm * cfg.advertised_cashback_rate)
                ok = ledger.mark_approved(conn, order.order_id, approved_comm, cashback)
                if ok:
                    summary.approved += 1
                else:
                    summary.skipped += 1

            elif order.status == "rejected" and current_status != "rejected":
                ok = ledger.mark_rejected(
                    conn, order.order_id, order.rejection_reason or "Cancelled on TikTok Shop"
                )
                if ok:
                    summary.rejected += 1
                else:
                    summary.skipped += 1
            else:
                summary.skipped += 1

        conn.commit()

    return summary
