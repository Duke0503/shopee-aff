"""Lazada Affiliate Provider via AccessTrade Publisher API.

Integrates with AccessTrade Publisher API to generate Lazada affiliate links
with sub1 (customer_id) and sub2 (request_id) tracking, resolve product details,
and parse conversion orders.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Optional

import httpx

from .base import (
    AffiliateLinkResult,
    BaseAffiliateProvider,
    NormalizedOrder,
    ProductPreview,
)
from ..core.policy import round_dong
from ..ledger import repository as ledger

log = logging.getLogger(__name__)

LAZADA_DOMAINS = (
    "lazada.vn",
    "s.lazada.vn",
    "c.lazada.vn",
    "www.lazada.vn",
)

ANY_LAZADA_URL = re.compile(
    r"https?://(?:[\w-]+\.)*(?:lazada\.vn|s\.lazada\.vn|c\.lazada\.vn)/\S+",
    re.IGNORECASE,
)

LAZADA_ITEM_ID = re.compile(r"-i([0-9]+)")
LAZADA_SHORT_CODE = re.compile(r"s\.lazada\.vn/s\.([A-Za-z0-9_-]+)")


def _vnd_format(amount: int) -> str:
    grouped = f"{round(amount):,}".replace(",", ".")
    return f"{grouped}đ"


class LazadaAccessTradeProvider(BaseAffiliateProvider):
    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        campaign_id: Optional[str] = None,
        timeout: float = 10.0,
    ) -> None:
        self._api_key = api_key or os.getenv("ACCESSTRADE_API_KEY", "").strip()
        self._base_url = (
            base_url or os.getenv("ACCESSTRADE_BASE_URL", "https://api.accesstrade.vn").strip()
        ).rstrip("/")
        # Default AccessTrade Lazada Vietnam campaign ID (5087153089503673507)
        self._campaign_id = campaign_id or os.getenv("ACCESSTRADE_LAZADA_CAMPAIGN_ID", "5087153089503673507").strip()
        self._timeout = timeout

    @property
    def platform_name(self) -> str:
        return "lazada"

    @property
    def is_configured(self) -> bool:
        return bool(self._api_key)

    def match_url(self, url: str) -> bool:
        if not url:
            return False
        return bool(ANY_LAZADA_URL.search(str(url).strip()))

    def normalize_url(self, url: str) -> str:
        if not url:
            return ""
        clean = str(url).strip()
        match = ANY_LAZADA_URL.search(clean)
        clean = match.group(0) if match else clean

        # Unshorten s.lazada.vn
        if "s.lazada.vn" in clean:
            try:
                with httpx.Client(
                    follow_redirects=True,
                    timeout=8.0,
                    headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
                ) as client:
                    resp = client.get(clean)
                    return str(resp.url)
            except Exception:
                pass
        return clean

    def _extract_item_id(self, url: str) -> str:
        match_prod = LAZADA_ITEM_ID.search(url)
        if match_prod:
            return match_prod.group(1)
        match_short = LAZADA_SHORT_CODE.search(url)
        if match_short:
            return match_short.group(1)
        return str(abs(hash(url)))[:12]

    def _extract_name_from_url(self, url: str) -> str:
        try:
            path_part = url.split("?")[0].rstrip("/")
            slug = path_part.split("/")[-1].replace(".html", "")
            if "-i" in slug:
                slug = slug.split("-i")[0]
            name = slug.replace("-", " ").strip()
            if name and len(name) > 3:
                return name.title()
        except Exception:
            pass
        return "Sản phẩm Lazada"

    def _call_accesstrade_create_link(
        self,
        product_url: str,
        customer_id: str,
        request_id: str,
    ) -> dict[str, Any]:
        """Call AccessTrade product link create API."""
        if not self.is_configured:
            return {
                "status": True,
                "aff_short_url": f"https://shorten.asia/lazada_sim_{request_id}",
                "product_name": self._extract_name_from_url(product_url),
                "product_image": "",
                "product_price": 200000,
                "product_commission": 16000,
                "simulated": True,
            }

        endpoint = f"{self._base_url}/v1/product_link/create"
        auth_header = self._api_key if self._api_key.startswith("Token ") else f"Token {self._api_key}"

        payload = {
            "campaign_id": self._campaign_id,
            "urls": [product_url],
            "sub1": customer_id,
            "sub2": request_id,
            "sub3": "cashback",
            "utm_source": "cashback_bot",
        }

        headers = {
            "Authorization": auth_header,
            "Content-Type": "application/json",
            "User-Agent": "CashbackBot/1.0",
        }

        try:
            with httpx.Client(timeout=self._timeout) as client:
                resp = client.post(endpoint, json=payload, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    # AccessTrade returns array in data or success format
                    short_url = ""
                    if isinstance(data, dict):
                        data_list = data.get("data") or []
                        if data_list and isinstance(data_list, list):
                            short_url = data_list[0].get("short_url") or data_list[0].get("aff_link") or ""
                        elif data.get("short_url"):
                            short_url = data.get("short_url")
                        elif data.get("aff_link"):
                            short_url = data.get("aff_link")
                    
                    if short_url:
                        return {
                            "status": True,
                            "aff_short_url": short_url,
                            "product_name": self._extract_name_from_url(product_url),
                            "product_price": 0,
                            "product_commission": 0,
                        }
                    return {"status": False, "error": "empty_link"}
                else:
                    log.warning(f"AccessTrade Lazada API failed: {resp.status_code} - {resp.text}")
                    return {"status": False, "error": f"http_{resp.status_code}"}
        except Exception as exc:
            log.exception(f"Error calling AccessTrade for Lazada: {exc}")
            return {"status": False, "error": str(exc)}

    def preview(self, url: str, advertised_rate: float = 0.80) -> Optional[ProductPreview]:
        target_url = self.normalize_url(url)
        item_id = self._extract_item_id(target_url)
        name = self._extract_name_from_url(target_url)

        res = self._call_accesstrade_create_link(target_url, "preview", "preview")
        price = int(res.get("product_price") or 0)
        comm = int(res.get("product_commission") or 0)
        name = res.get("product_name") or name

        net_comm = round_dong(comm * (1 - 0.10 - 0.0098)) if comm > 0 else 0
        cb = round_dong(net_comm * advertised_rate) if net_comm > 0 else 0

        return ProductPreview(
            platform=self.platform_name,
            item_id=f"lazada_{item_id}",
            name=name,
            image_url=res.get("product_image") or "",
            price=price,
            price_formatted=_vnd_format(price) if price > 0 else "Theo Lazada",
            commission_rate=0.08,
            raw_commission=comm,
            commission_formatted=_vnd_format(comm) if comm > 0 else "8% theo sàn",
            net_commission=net_comm,
            cashback_amount=cb,
            cashback_formatted=_vnd_format(cb) if cb > 0 else "80% hoa hồng sàn",
            is_capped=False,
            canonical_url=target_url,
            source_rate_info={"source": "accesstrade_lazada"},
        )

    def create_link(
        self,
        url: str,
        customer_id: str,
        request_id: str,
        conn: Optional[Any] = None,
        advertised_rate: float = 0.80,
    ) -> AffiliateLinkResult:
        target_url = self.normalize_url(url)
        item_id = self._extract_item_id(target_url)

        # 1. Check existing request in link_requests
        if conn is not None:
            existing = ledger.find_reusable_request(
                conn, customer_id, target_url, resend_within_days=7, platform=self.platform_name
            )
            if existing is not None and existing["affiliate_url"]:
                cached_prev = self.preview(target_url, advertised_rate)
                return AffiliateLinkResult(
                    platform=self.platform_name,
                    request_id=existing["request_id"],
                    affiliate_url=existing["affiliate_url"],
                    is_ready=True,
                    product_preview=cached_prev,
                    cached=True,
                )

        # 2. Call AccessTrade API
        actual_req_id = request_id
        res = self._call_accesstrade_create_link(target_url, customer_id, actual_req_id)
        if not res.get("status") and not res.get("aff_short_url"):
            # Fallback simulated link if AccessTrade API fails or not yet configured
            aff_url = f"https://shorten.asia/lazada_sim_{actual_req_id}"
            res["aff_short_url"] = aff_url

        aff_url = res.get("aff_short_url")
        name = res.get("product_name") or self._extract_name_from_url(target_url)
        price = int(res.get("product_price") or 0)
        comm = int(res.get("product_commission") or 0)

        net_comm = round_dong(comm * (1 - 0.10 - 0.0098)) if comm > 0 else 0
        cb = round_dong(net_comm * advertised_rate) if net_comm > 0 else 0

        preview = ProductPreview(
            platform=self.platform_name,
            item_id=f"lazada_{item_id}",
            name=name,
            image_url=res.get("product_image") or "",
            price=price,
            price_formatted=_vnd_format(price) if price > 0 else "Theo Lazada",
            commission_rate=0.08,
            raw_commission=comm,
            commission_formatted=_vnd_format(comm) if comm > 0 else "8% theo sàn",
            net_commission=net_comm,
            cashback_amount=cb,
            cashback_formatted=_vnd_format(cb) if cb > 0 else "80% hoa hồng sàn",
            is_capped=False,
            canonical_url=target_url,
            source_rate_info={"source": "accesstrade_lazada"},
        )

        # 3. Store in link_requests
        if conn is not None:
            ledger.record_link_request(
                conn,
                request_id=actual_req_id,
                customer_id=customer_id,
                source_url=target_url,
                affiliate_url=aff_url,
                estimated_commission=comm,
                channel="zalo",
                platform=self.platform_name,
            )
            detail_json = json.dumps({
                "name": name,
                "price": price,
                "commission": comm,
                "cashback": cb,
                "platform": "lazada",
                "source": "accesstrade_lazada",
            }, ensure_ascii=False)
            conn.execute(
                "UPDATE link_requests SET estimate_detail = ?, estimate_source = 'accesstrade_lazada', status = 'ready' WHERE request_id = ?",
                (detail_json, actual_req_id),
            )

            # 4. Upsert into products_cache
            ledger.upsert_product_cache(
                conn,
                item_id=f"lazada_{item_id}",
                shop_id="lazada_vn",
                name=name,
                price=price,
                price_formatted=_vnd_format(price) if price > 0 else "Theo Lazada",
                shopee_rate=0.0,
                seller_rate=8.0,
                shopee_part=0,
                shopee_part_formatted="0đ",
                seller_part=comm,
                seller_part_formatted=_vnd_format(comm) if comm > 0 else "8%",
                total_commission=comm,
                commission_formatted=_vnd_format(comm) if comm > 0 else "8%",
                is_capped=False,
                cashback=cb,
                cashback_formatted=_vnd_format(cb) if cb > 0 else "80% hoa hồng sàn",
                rate_percent=f"{advertised_rate:.0%}",
                affiliate_url=aff_url,
                canonical_url=target_url,
                image_url="",
                increment_count=True,
            )
            conn.commit()

        return AffiliateLinkResult(
            platform=self.platform_name,
            request_id=actual_req_id,
            affiliate_url=aff_url,
            is_ready=True,
            product_preview=preview,
            cached=False,
        )

    def parse_orders(self, raw_data: Any) -> list[NormalizedOrder]:
        """Normalize AccessTrade orders for Lazada conversions."""
        raw_orders = []
        if isinstance(raw_data, dict):
            raw_orders = raw_data.get("data") or raw_data.get("orders") or [raw_data]
        elif isinstance(raw_data, list):
            raw_orders = raw_data

        normalized: list[NormalizedOrder] = []
        for o in raw_orders:
            if not isinstance(o, dict):
                continue
            # Check campaign or domain
            camp_name = str(o.get("campaign_name") or o.get("merchant") or "").lower()
            camp_id = str(o.get("campaign_id") or "")
            if camp_name and "lazada" not in camp_name and camp_id and camp_id != self._campaign_id:
                continue

            order_id = str(o.get("order_id") or o.get("order_sn") or o.get("id") or "")
            if not order_id:
                continue

            status_code = str(o.get("order_status") if o.get("order_status") is not None else o.get("status", "")).strip().lower()
            status = "awaiting_approval"
            if status_code in ("1", "approved", "success"):
                status = "approved"
            elif status_code in ("2", "rejected", "canceled", "cancelled"):
                status = "rejected"

            val = int(round(float(o.get("order_value") or o.get("order_amount") or o.get("billing") or o.get("price") or 0)))
            comm = int(round(float(o.get("pub_commission") or o.get("commission") or 0)))

            normalized.append(NormalizedOrder(
                order_id=order_id,
                platform=self.platform_name,
                customer_id=str(o.get("sub1") or o.get("sub_1") or "").strip(),
                request_id=str(o.get("sub2") or o.get("sub_2") or "").strip() or None,
                order_value=val,
                estimated_commission=comm,
                approved_commission=comm if status == "approved" else None,
                status=status,
                rejection_reason=str(o.get("reject_reason") or o.get("rejection_reason") or "") if status == "rejected" else None,
                order_time=str(o.get("transaction_time") or o.get("order_time") or o.get("created_time") or ""),
            ))
        return normalized

    def reconcile_orders(self, raw_orders: list[dict[str, Any]]) -> list[NormalizedOrder]:
        return self.parse_orders(raw_orders)
