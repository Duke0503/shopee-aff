"""ShopeeFood Affiliate Provider.

Handles ShopeeFood restaurant and dish links (shopeefood.vn, food.shopee.vn),
generates custom affiliate tracking links with sub_id tracking,
and registers conversions for food cashback.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
from typing import Any, Optional
import urllib.parse
import urllib.request

from .base import (
    AffiliateLinkResult,
    BaseAffiliateProvider,
    NormalizedOrder,
    ProductPreview,
)
from ..core.policy import round_dong
from ..ledger import repository as ledger

log = logging.getLogger(__name__)

ANY_SHOPEEFOOD_URL = re.compile(
    r"https?://(?:[\w-]+\.)*(?:shopeefood\.vn|food\.shopee\.vn|shopee\.vn/now-food)/\S+",
    re.IGNORECASE,
)


def _slug_to_title(slug: str) -> str:
    cleaned = re.sub(r"[^\w\s-]", "", slug).replace("-", " ").strip()
    words = [w.capitalize() for w in cleaned.split() if w]
    return " ".join(words) or "Quán ăn ShopeeFood"


def unwrap_shopeefood_url(raw_url: str, timeout: float = 4.0) -> tuple[str, bool]:
    """Resolve short links (e.g. shopeefood.vn/u/..., /share/...) to their target shop.

    If the link is a group order invite (/group-order/invite?token=...), extracts
    the shopId from the token payload and returns (canonical_shop_url, True).
    Otherwise returns (canonical_url, False).
    """
    clean = str(raw_url).strip()
    match = ANY_SHOPEEFOOD_URL.search(clean)
    if match:
        clean = match.group(0)

    parsed = urllib.parse.urlparse(clean)
    is_group = False

    is_short = parsed.netloc.endswith("shopeefood.vn") and any(
        parsed.path.startswith(p) for p in ("/u/", "/share/")
    )
    is_direct_group = "/group-order/invite" in parsed.path

    resolved_url = clean
    if is_short or is_direct_group:
        if is_short:
            try:
                req = urllib.request.Request(
                    clean,
                    headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
                )
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    resolved_url = resp.geturl()
            except Exception:
                resolved_url = clean

        res_parsed = urllib.parse.urlparse(resolved_url)
        if "/group-order/invite" in res_parsed.path:
            is_group = True
            qs = urllib.parse.parse_qs(res_parsed.query)
            token_str = qs.get("token", [""])[0]
            if token_str:
                try:
                    pad = len(token_str) % 4
                    if pad:
                        token_str += "=" * (4 - pad)
                    data = json.loads(base64.b64decode(token_str).decode("utf-8"))
                    shop_id = data.get("shopId")
                    if shop_id:
                        return f"https://shopeefood.vn/now-food/shop/{shop_id}", True
                except Exception:
                    pass

    p = urllib.parse.urlparse(resolved_url)
    canonical = urllib.parse.urlunparse((p.scheme, p.netloc, p.path, "", "", "")).rstrip("/")
    return canonical, is_group


class ShopeeFoodProvider(BaseAffiliateProvider):
    def __init__(self, timeout: float = 10.0) -> None:
        self._timeout = timeout

    @property
    def platform_name(self) -> str:
        return "shopeefood"

    def match_url(self, url: str) -> bool:
        if not url:
            return False
        return bool(ANY_SHOPEEFOOD_URL.search(str(url).strip()))

    def normalize_url(self, url: str) -> str:
        if not url:
            return ""
        canonical, _ = unwrap_shopeefood_url(url, timeout=self._timeout)
        return canonical

    def _extract_item_id(self, url: str) -> str:
        parsed = urllib.parse.urlparse(url)
        path_parts = [p for p in parsed.path.split("/") if p]
        if path_parts:
            return path_parts[-1]
        return str(abs(hash(url)))[:12]

    def _extract_name(self, url: str) -> str:
        parsed = urllib.parse.urlparse(url)
        path_parts = [p for p in parsed.path.split("/") if p]
        if not path_parts:
            return ""
        # Short links like /u/u1vZZ8Q, technical paths or group orders don't carry human-readable store names
        if path_parts[0].lower() in ("u", "share", "now-food", "food", "group-order"):
            return ""
        if len(path_parts) >= 2:
            # e.g. /ho-chi-minh/tra-sua-gong-cha
            city = path_parts[0].replace("-", " ").title()
            store = _slug_to_title(path_parts[1])
            return f"{store} ({city})"
        elif len(path_parts) == 1:
            return _slug_to_title(path_parts[0])
        return ""

    def preview(self, url: str, advertised_rate: float = 0.80) -> Optional[ProductPreview]:
        target_url, is_group = unwrap_shopeefood_url(url, timeout=self._timeout)
        item_id = self._extract_item_id(target_url)
        name = self._extract_name(target_url)

        return ProductPreview(
            platform=self.platform_name,
            item_id=f"food_{item_id}",
            name=name,
            image_url="",
            price=0,
            price_formatted="Theo thực đơn quán",
            commission_rate=0.05,
            raw_commission=0,
            commission_formatted="Tích lũy theo quán",
            net_commission=0,
            cashback_amount=0,
            cashback_formatted="80% hoa hồng sàn",
            is_capped=True,
            canonical_url=target_url,
            source_rate_info={"source": "shopeefood_policy", "is_group_order": is_group},
        )

    def create_link(
        self,
        url: str,
        customer_id: str,
        request_id: str,
        conn: Optional[Any] = None,
        advertised_rate: float = 0.80,
    ) -> AffiliateLinkResult:
        target_url, is_group = unwrap_shopeefood_url(url, timeout=self._timeout)
        item_id = self._extract_item_id(target_url)
        name = self._extract_name(target_url)

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

        actual_req_id = request_id

        # 2. Generate affiliate link
        # Attempt to use Shopee Custom Link generator if bridge is connected
        aff_url = None
        try:
            from ..shopee.browser_bridge import Bridge
            from ..shopee.link_generator import generate_short_link
            bridge = Bridge()
            if bridge.is_alive():
                generated = generate_short_link(
                    bridge,
                    target_url,
                    sub_ids=[customer_id, actual_req_id],
                )
                if generated:
                    aff_url = generated
        except Exception:
            pass

        is_ready = bool(aff_url)

        preview = ProductPreview(
            platform=self.platform_name,
            item_id=f"food_{item_id}",
            name=name,
            image_url="",
            price=0,
            price_formatted="Theo thực đơn quán",
            commission_rate=0.05,
            raw_commission=0,
            commission_formatted="Tích lũy theo quán",
            net_commission=0,
            cashback_amount=0,
            cashback_formatted="80% hoa hồng sàn",
            is_capped=True,
            canonical_url=target_url,
            source_rate_info={"source": "shopeefood_policy", "is_group_order": is_group},
        )

        # 3. Store in link_requests
        if conn is not None:
            ledger.record_link_request(
                conn,
                request_id=actual_req_id,
                customer_id=customer_id,
                source_url=target_url,
                affiliate_url=aff_url,
                estimated_commission=0,
                channel="zalo",
                platform=self.platform_name,
            )
            detail_json = json.dumps({
                "name": name,
                "price": 0,
                "commission": 0,
                "cashback": 0,
                "platform": "shopeefood",
                "source": "shopeefood",
                "is_group_order": is_group,
            }, ensure_ascii=False)
            status_val = "ready" if is_ready else "pending"
            conn.execute(
                "UPDATE link_requests SET estimate_detail = ?, estimate_source = 'shopeefood', status = ? WHERE request_id = ?",
                (detail_json, status_val, actual_req_id),
            )

            # 4. Upsert into products_cache if ready
            if is_ready:
                ledger.upsert_product_cache(
                    conn,
                    item_id=f"food_{item_id}",
                    shop_id="shopeefood_vn",
                    name=name,
                    price=0,
                    price_formatted="Theo thực đơn quán",
                    shopee_rate=5.0,
                    seller_rate=0.0,
                    shopee_part=0,
                    shopee_part_formatted="0đ",
                    seller_part=0,
                    seller_part_formatted="0đ",
                    total_commission=0,
                    commission_formatted="Tích lũy",
                    is_capped=True,
                    cashback=0,
                    cashback_formatted="80% hoa hồng sàn",
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
            is_ready=is_ready,
            product_preview=preview,
            cached=False,
        )

    def parse_orders(self, raw_data: Any) -> list[NormalizedOrder]:
        """Normalize conversion orders for ShopeeFood."""
        raw_orders = []
        if isinstance(raw_data, dict):
            raw_orders = raw_data.get("data") or raw_data.get("orders") or [raw_data]
        elif isinstance(raw_data, list):
            raw_orders = raw_data

        normalized: list[NormalizedOrder] = []
        for o in raw_orders:
            if not isinstance(o, dict):
                continue
            order_id = str(o.get("order_id") or o.get("order_sn") or o.get("id") or "")
            if not order_id:
                continue

            status_val = str(o.get("status") or o.get("order_status") or "").strip().lower()
            if status_val in ("completed", "approved", "1", "success"):
                status = "approved"
            elif status_val in ("canceled", "cancelled", "rejected", "2"):
                status = "rejected"
            else:
                status = "awaiting_approval"

            val = int(round(float(o.get("order_value") or o.get("billing") or o.get("price") or 0)))
            comm = int(round(float(o.get("commission") or o.get("pub_commission") or 0)))

            normalized.append(NormalizedOrder(
                order_id=order_id,
                platform=self.platform_name,
                customer_id=str(o.get("sub1") or o.get("sub_1") or "").strip(),
                request_id=str(o.get("sub2") or o.get("sub_2") or "").strip() or None,
                order_value=val,
                estimated_commission=comm,
                approved_commission=comm if status == "approved" else None,
                status=status,
                rejection_reason=str(o.get("reject_reason") or "") if status == "rejected" else None,
                order_time=str(o.get("order_time") or o.get("created_time") or ""),
            ))
        return normalized

    def reconcile_orders(self, raw_orders: list[dict[str, Any]]) -> list[NormalizedOrder]:
        return self.parse_orders(raw_orders)
