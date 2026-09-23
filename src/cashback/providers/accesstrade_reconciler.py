"""AccessTrade Order Reconciliation module.

Polls AccessTrade Orders API (or processes webhooks) to synchronize
TikTok Shop affiliate conversion orders and settle customer cashback.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Any, Optional

import httpx

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


def sync_accesstrade_orders(
    cfg: Config,
    raw_orders: Optional[list[dict[str, Any]]] = None,
    since_days: int = 30,
) -> ReconcileSummary:
    """Synchronize AccessTrade orders into the ledger."""
    summary = ReconcileSummary()
    provider = TikTokAccessTradeProvider(
        api_key=cfg.accesstrade_api_key,
        base_url=cfg.accesstrade_base_url,
    )

    if raw_orders is None:
        if not cfg.accesstrade_api_key:
            summary.error = "ACCESSTRADE_API_KEY is not configured"
            return summary
        try:
            raw_orders = fetch_accesstrade_orders(
                api_key=cfg.accesstrade_api_key,
                base_url=cfg.accesstrade_base_url,
                since_days=since_days,
            )
        except Exception as exc:
            summary.error = str(exc)
            return summary

    normalized_orders = provider.parse_orders(raw_orders)
    summary.rows_read = len(normalized_orders)

    with ledger.connect(cfg.db_path) as conn:
        for order in normalized_orders:
            existing = ledger.get_order(conn, order.order_id)
            if not existing:
                valid_cust_id = None
                if order.customer_id:
                    cust_row = conn.execute(
                        "SELECT customer_id FROM customers WHERE customer_id = ? OR zalo_user_id = ?",
                        (order.customer_id, order.customer_id),
                    ).fetchone()
                    if cust_row:
                        valid_cust_id = cust_row["customer_id"]
                    else:
                        ledger.add_customer(conn, order.customer_id, display_name=order.customer_id)
                        valid_cust_id = order.customer_id

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
