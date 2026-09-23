from __future__ import annotations

import json
from typing import Any, Optional

from .base import BaseAffiliateProvider, ProductPreview, AffiliateLinkResult, NormalizedOrder
from ..core.policy import round_dong
from ..ledger import repository as ledger
from ..shopee.dashboard_lookup import (
    ANY_SHOPEE_URL,
    parse_url,
    is_short_link,
    resolve_short_link,
)
from ..shopee.commission import lookup


def _vnd_format(amount: int) -> str:
    grouped = f"{round(amount):,}".replace(",", ".")
    return f"{grouped}đ"


class ShopeeProvider(BaseAffiliateProvider):
    @property
    def platform_name(self) -> str:
        return "shopee"

    def match_url(self, url: str) -> bool:
        if not url:
            return False
        clean = str(url).strip().lower()
        if "food.shopee.vn" in clean or "shopee.vn/now-food" in clean or "shopeefood.vn" in clean:
            return False
        return bool(ANY_SHOPEE_URL.search(str(url).strip()))

    def normalize_url(self, url: str) -> str:
        if not url:
            return ""
        clean = str(url).strip()
        match = ANY_SHOPEE_URL.search(clean)
        if not match:
            return clean
        target_url = match.group(0)
        if is_short_link(target_url):
            try:
                target_url = resolve_short_link(target_url)
            except Exception:
                pass
        return target_url

    def preview(self, url: str, advertised_rate: float) -> Optional[ProductPreview]:
        target_url = self.normalize_url(url)
        try:
            est = lookup(target_url, third_party=True)
        except Exception:
            return None

        if not est or est.price <= 0:
            return None

        raw_comm = est.commission
        net_comm = round_dong(raw_comm * (1 - 0.10 - 0.0098))
        cb = round_dong(net_comm * advertised_rate)

        parsed = parse_url(target_url)
        item_id = str(parsed[2]) if parsed else ""

        return ProductPreview(
            platform=self.platform_name,
            item_id=item_id,
            name=est.name,
            image_url=getattr(est, "image_url", "") or "",
            price=est.price,
            price_formatted=_vnd_format(est.price),
            commission_rate=est.total_rate,
            raw_commission=raw_comm,
            commission_formatted=_vnd_format(raw_comm),
            net_commission=net_comm,
            cashback_amount=cb,
            cashback_formatted=_vnd_format(cb),
            is_capped=est.is_capped,
            canonical_url=target_url,
            source_rate_info={
                "shopee_rate": est.shopee_rate,
                "shopee_part": est.shopee_part,
                "shopee_part_formatted": _vnd_format(est.shopee_part),
                "seller_rate": est.seller_rate,
                "seller_part": est.seller_part,
                "seller_part_formatted": _vnd_format(est.seller_part),
                "source": est.source,
            },
        )

    def create_link(
        self,
        url: str,
        customer_id: str,
        request_id: str,
        conn: Any,
        advertised_rate: float,
    ) -> AffiliateLinkResult:
        target_url = self.normalize_url(url)
        parsed = parse_url(target_url)

        # 1. Check products_cache
        if parsed:
            _, shop_id, item_id = parsed
            cached = ledger.get_product_cache(conn, item_id)
            if cached and cached["affiliate_url"]:
                return AffiliateLinkResult(
                    platform=self.platform_name,
                    request_id=request_id,
                    affiliate_url=cached["affiliate_url"],
                    is_ready=True,
                    cached=True,
                )

        # 2. Check reusable requests
        existing = ledger.find_reusable_request(conn, customer_id, url, resend_within_days=7, platform=self.platform_name)
        if existing is not None and existing["affiliate_url"]:
            if parsed:
                ledger.upsert_product_cache(
                    conn, item_id=parsed[2], shop_id=parsed[1], affiliate_url=existing["affiliate_url"]
                )
                conn.commit()
            return AffiliateLinkResult(
                platform=self.platform_name,
                request_id=existing["request_id"],
                affiliate_url=existing["affiliate_url"],
                is_ready=True,
                cached=True,
            )

        # 3. Create or reuse request in link_requests
        actual_req_id = existing["request_id"] if existing else request_id
        if not existing:
            ledger.record_link_request(
                conn,
                request_id=actual_req_id,
                customer_id=customer_id,
                source_url=url,
                affiliate_url=None,
                estimated_commission=None,
                channel="web",
                platform=self.platform_name,
            )
            conn.commit()

        # Attach cached estimate detail if available
        if parsed:
            _, _, item_id = parsed
            cached = ledger.get_product_cache(conn, item_id)
            if cached and cached["name"]:
                detail_json = json.dumps({
                    "name": cached["name"],
                    "price": cached["price"] or 0,
                    "commission": cached["total_commission"] or 0,
                    "shopee_rate": cached["shopee_rate"] or 0,
                    "seller_rate": cached["seller_rate"] or 0,
                    "shopee_part": cached["shopee_part"] or 0,
                    "seller_part": cached["seller_part"] or 0,
                    "total_rate": (cached["shopee_rate"] or 0) + (cached["seller_rate"] or 0),
                    "is_capped": bool(cached["is_capped"]),
                    "source": "shopee",
                    "image_url": cached["image_url"] or "",
                    "item_id": str(item_id),
                }, ensure_ascii=False)
                conn.execute(
                    "UPDATE link_requests SET estimate_detail = ?, estimated_commission = COALESCE(estimated_commission, ?), estimate_source = COALESCE(estimate_source, 'shopee') WHERE request_id = ?",
                    (detail_json, cached["total_commission"], actual_req_id),
                )
                conn.commit()

        req_row = conn.execute(
            "SELECT affiliate_url FROM link_requests WHERE request_id=?", (actual_req_id,)
        ).fetchone()
        if req_row and req_row["affiliate_url"]:
            return AffiliateLinkResult(
                platform=self.platform_name,
                request_id=actual_req_id,
                affiliate_url=req_row["affiliate_url"],
                is_ready=True,
            )

        # Needs browser worker to generate link asynchronously
        return AffiliateLinkResult(
            platform=self.platform_name,
            request_id=actual_req_id,
            affiliate_url=None,
            is_ready=False,
        )

    def parse_orders(self, raw_data: Any) -> list[NormalizedOrder]:
        results: list[NormalizedOrder] = []
        rows = raw_data if isinstance(raw_data, list) else []
        for r in rows:
            results.append(NormalizedOrder(
                order_id=str(r.get("order_id", "")),
                platform=self.platform_name,
                customer_id=str(r.get("customer_id", "")),
                request_id=r.get("request_id"),
                order_value=int(r.get("order_value", 0)),
                estimated_commission=int(r.get("estimated_commission", 0)),
                approved_commission=int(r.get("approved_commission")) if r.get("approved_commission") is not None else None,
                status=str(r.get("status", "awaiting_approval")),
                rejection_reason=r.get("rejection_reason"),
                order_time=str(r.get("purchase_time", "")),
            ))
        return results
