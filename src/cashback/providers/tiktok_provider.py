"""TikTok Shop Affiliate Provider via AccessTrade Publisher API v2.

Integrates with AccessTrade Publisher API to generate TikTok Shop affiliate links
with sub1 (customer_id) and sub2 (request_id) tracking, resolve product details,
and parse conversion orders.
"""

from __future__ import annotations

import json
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

# TikTok domains: app short links, web product links, and shop domain
TIKTOK_DOMAINS = (
    "tiktok.com",
    "vt.tiktok.com",
    "vm.tiktok.com",
    "shop.tiktok.com",
    "tiktok.shop",
    "m.tiktok.shop",
)

ANY_TIKTOK_URL = re.compile(
    r"https?://(?:[\w-]+\.)*(?:tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com|tiktok\.shop)/\S+",
    re.IGNORECASE,
)

TIKTOK_PRODUCT_ID = re.compile(r"/(?:product|pdp)/([0-9]+)")
TIKTOK_SHORT_CODE = re.compile(r"/(?:vt|vm)\.tiktok\.com/([A-Za-z0-9_-]+)")


def _vnd_format(amount: int) -> str:
    grouped = f"{round(amount):,}".replace(",", ".")
    return f"{grouped}đ"


def _format_price(price_obj: Any, default_amount: int = 0) -> str:
    """Format price nicely, handling range {minimum_amount, maximum_amount}."""
    if isinstance(price_obj, dict):
        min_a = _parse_amount(price_obj.get("minimum_amount"))
        max_a = _parse_amount(price_obj.get("maximum_amount"))
        if min_a > 0 and max_a > 0 and min_a != max_a:
            return f"{_vnd_format(min_a)} - {_vnd_format(max_a)}"
        if min_a > 0:
            return _vnd_format(min_a)
        if max_a > 0:
            return _vnd_format(max_a)
        if "amount" in price_obj:
            return _vnd_format(_parse_amount(price_obj.get("amount")))
    if default_amount > 0:
        return _vnd_format(default_amount)
    return "0đ"


def _parse_amount(val: Any) -> int:
    """Robustly parse Vietnamese currency amount or number from AccessTrade responses.

    Handles:
    - 250000 -> 250000
    - "250000" -> 250000
    - "3.000" -> 3000 (thousands separator with dots)
    - "250,000" -> 250000 (thousands separator with commas)
    - "2156.97664" -> 2157 (decimal VND from real API)
    - 2208.0 -> 2208 (float currency)
    - {"amount": "3.000"} -> 3000
    - {"minimum_amount": "27730", "maximum_amount": "49000"} -> 27730 (prefer min)
    """
    if val is None:
        return 0
    if isinstance(val, dict):
        # Real API: product_price has minimum_amount / maximum_amount (no "amount" key)
        if "minimum_amount" in val or "maximum_amount" in val:
            raw = val.get("minimum_amount") or val.get("maximum_amount") or 0
            return _parse_amount(raw)
        return _parse_amount(val.get("amount", 0))
    if isinstance(val, (int, float)):
        return int(round(val))
    s = str(val).strip()
    if not s:
        return 0
    clean = s.replace(" ", "").replace("đ", "").replace("VND", "").replace("vnd", "")
    if "." in clean and "," in clean:
        if clean.rfind(",") > clean.rfind("."):
            clean = clean.replace(".", "").replace(",", ".")
        else:
            clean = clean.replace(",", "")
    elif clean.count(".") > 1:
        clean = clean.replace(".", "")
    elif clean.count(",") > 1:
        clean = clean.replace(",", "")
    elif "." in clean:
        parts = clean.split(".")
        # Vietnamese currency format e.g. "350.000" (350k) or "35.000" (35k) where left has 1-3 digits and right is "000"
        if len(parts) == 2 and 1 <= len(parts[0]) <= 3 and len(parts[1]) == 3 and (parts[1] == "000" or float(parts[0]) < 100):
            clean = clean.replace(".", "")
    elif "," in clean:
        parts = clean.split(",")
        if len(parts) == 2 and len(parts[1]) == 3 and len(parts[0]) <= 3:
            clean = clean.replace(",", "")
        else:
            clean = clean.replace(",", ".")
    try:
        return int(round(float(clean)))
    except (ValueError, TypeError):
        return 0


def _parse_comm_rate(val: Any) -> float:
    """Parse commission rate from AccessTrade.

    Real API returns rate as float string "0.07777" (0-1 decimal).
    Old/simulated may return int 1500 (hundredths of percent, 1500 = 15%).
    Returns a 0-1 decimal float.
    """
    if val is None:
        return 0.0
    try:
        f = float(str(val).strip())
        # If value >= 1, it's in hundredths of percent (e.g. 1500 = 15%)
        if f >= 1:
            return f / 10000
        return f  # Already 0-1 decimal
    except (ValueError, TypeError):
        return 0.0


class TikTokAccessTradeProvider(BaseAffiliateProvider):
    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: float = 10.0,
    ) -> None:
        self._api_key = api_key or os.getenv("ACCESSTRADE_API_KEY", "").strip()
        self._base_url = (
            base_url or os.getenv("ACCESSTRADE_BASE_URL", "https://api.accesstrade.vn").strip()
        ).rstrip("/")
        self._timeout = timeout

    @property
    def platform_name(self) -> str:
        return "tiktok"

    @property
    def is_configured(self) -> bool:
        return bool(self._api_key)

    def match_url(self, url: str) -> bool:
        if not url:
            return False
        return bool(ANY_TIKTOK_URL.search(str(url).strip()))

    def normalize_url(self, url: str) -> str:
        if not url:
            return ""
        clean = str(url).strip()
        match = ANY_TIKTOK_URL.search(clean)
        clean = match.group(0) if match else clean

        # Resolve short links (vt.tiktok.com, vm.tiktok.com) to canonical product URL
        if "vt.tiktok.com" in clean or "vm.tiktok.com" in clean:
            try:
                with httpx.Client(follow_redirects=True, timeout=8.0, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}) as client:
                    resp = client.get(clean)
                    final_url = str(resp.url)
                    m = TIKTOK_PRODUCT_ID.search(final_url)
                    if m:
                        return f"https://shop.tiktok.com/view/product/{m.group(1)}?region=VN&local=en"
                    return final_url
            except Exception:
                pass
        return clean

    def _extract_item_id(self, url: str) -> str:
        match_prod = TIKTOK_PRODUCT_ID.search(url)
        if match_prod:
            return match_prod.group(1)
        match_short = TIKTOK_SHORT_CODE.search(url)
        if match_short:
            return match_short.group(1)
        # Fallback hash
        return str(abs(hash(url)))[:12]

    def _call_accesstrade_create_link(
        self,
        product_url: str,
        customer_id: str,
        request_id: str,
    ) -> dict[str, Any]:
        """Call AccessTrade Publisher API v2 to create affiliate link and fetch product info."""
        if not self.is_configured:
            # Simulated response for staging / testing without live API key
            return {
                "status": True,
                "aff_short_url": f"https://shorten.accesstrade.vn/t/simulated_{request_id}",
                "product_name": "Sản phẩm TikTok Shop (Mô phỏng)",
                "product_image": "",
                "product_price": {"amount": 250000},
                "product_commission": {"amount": 25000},
                "simulated": True,
            }

        endpoint = f"{self._base_url}/v2/tiktokshop_product_feeds/create_link"
        auth_header = self._api_key
        if not auth_header.startswith("Token "):
            auth_header = f"Token {auth_header}"

        headers = {
            "Authorization": auth_header,
            "Content-Type": "application/json",
            "User-Agent": "CashbackBot/1.0",
        }
        payload = {
            "product_url": product_url,
            "sub1": customer_id,
            "sub2": request_id,
            "sub_1": customer_id,
            "sub_2": request_id,
            "utm_source": "cashback_bot",
            "utm_medium": "zalo_web",
        }

        with httpx.Client(timeout=self._timeout) as client:
            resp = client.post(endpoint, headers=headers, json=payload)
            resp.raise_for_status()
            return resp.json()

    def preview(self, url: str, advertised_rate: float) -> Optional[ProductPreview]:
        target_url = self.normalize_url(url)
        item_id = self._extract_item_id(target_url)

        # Call AccessTrade create link API with dummy IDs for metadata
        try:
            res = self._call_accesstrade_create_link(target_url, "preview", "preview")
        except Exception:
            return None

        data_obj = res.get("data") if isinstance(res.get("data"), dict) else res
        status = res.get("status")
        aff_link = (
            data_obj.get("aff_short_url")
            or data_obj.get("aff_url")
            or res.get("aff_short_url")
            or res.get("aff_url")
        )
        if status is False and not aff_link:
            return None

        name = data_obj.get("product_name") or res.get("product_name") or "Sản phẩm TikTok Shop"
        img = data_obj.get("product_image") or data_obj.get("image") or res.get("product_image") or ""

        price_obj = data_obj.get("product_price") or res.get("product_price")
        price = _parse_amount(price_obj)
        price_fmt = _format_price(price_obj, price)

        comm_obj = data_obj.get("product_commission") or res.get("product_commission")
        raw_commission = _parse_amount(comm_obj)

        if price <= 0 and raw_commission <= 0:
            return None

        comm_rate_parsed = _parse_comm_rate(comm_obj.get("rate") if isinstance(comm_obj, dict) else None)
        comm_rate = comm_rate_parsed if comm_rate_parsed > 0 else ((raw_commission / price) if price > 0 else 0.10)

        # Sanity check: commission cannot exceed product price
        if price > 0 and comm_rate > 0:
            expected = price * comm_rate
            if raw_commission > price or (raw_commission > expected * 2.5 and raw_commission > 50000):
                raw_commission = round_dong(expected)

        # Personal Income Tax withheld at source: 10%
        net_commission = round_dong(raw_commission * (1 - 0.10))
        cb = round_dong(net_commission * advertised_rate)

        return ProductPreview(
            platform=self.platform_name,
            item_id=item_id,
            name=name,
            image_url=img,
            price=price,
            price_formatted=price_fmt,
            commission_rate=comm_rate,
            raw_commission=raw_commission,
            commission_formatted=_vnd_format(raw_commission),
            net_commission=net_commission,
            cashback_amount=cb,
            cashback_formatted=_vnd_format(cb),
            is_capped=False,
            canonical_url=target_url,
            source_rate_info={
                "source": "accesstrade_tiktok",
                "simulated": bool(res.get("simulated")),
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
        item_id = self._extract_item_id(target_url)

        # 1. Check if user already requested this link recently
        existing = ledger.find_reusable_request(
            conn, customer_id, target_url, resend_within_days=7, platform=self.platform_name
        )
        if existing is not None and existing["affiliate_url"]:
            cached_preview = None
            if existing["estimate_detail"]:
                try:
                    det = json.loads(existing["estimate_detail"])
                    price = det.get("price", 0)
                    raw_comm = det.get("commission", 0)
                    net_comm = det.get("net_commission", round_dong(raw_comm * 0.9))
                    cb = det.get("cashback", round_dong(net_comm * advertised_rate))
                    rate_val = det.get("seller_rate") or det.get("total_rate") or 0.0
                    comm_rate = (rate_val / 100.0) if rate_val > 0 else ((raw_comm / price) if price > 0 else 0.10)
                    cached_preview = ProductPreview(
                        platform=self.platform_name,
                        item_id=det.get("item_id", item_id),
                        name=det.get("name", "Sản phẩm TikTok Shop"),
                        image_url=det.get("image_url", ""),
                        price=price,
                        price_formatted=det.get("price_formatted") or _vnd_format(price),
                        commission_rate=comm_rate,
                        raw_commission=raw_comm,
                        commission_formatted=_vnd_format(raw_comm),
                        net_commission=net_comm,
                        cashback_amount=cb,
                        cashback_formatted=_vnd_format(cb),
                        is_capped=False,
                        canonical_url=target_url,
                    )
                except Exception:
                    pass
            return AffiliateLinkResult(
                platform=self.platform_name,
                request_id=existing["request_id"],
                affiliate_url=existing["affiliate_url"],
                is_ready=True,
                cached=True,
                product_preview=cached_preview,
            )

        actual_req_id = existing["request_id"] if existing else request_id

        # 2. Call AccessTrade API synchronously (<1s response)
        try:
            res = self._call_accesstrade_create_link(target_url, customer_id, actual_req_id)
        except Exception as exc:
            return AffiliateLinkResult(
                platform=self.platform_name,
                request_id=actual_req_id,
                affiliate_url=None,
                is_ready=False,
                error=f"AccessTrade API error: {exc}",
            )

        data_obj = res.get("data") if isinstance(res.get("data"), dict) else res
        aff_url = (
            data_obj.get("aff_short_url")
            or data_obj.get("aff_url")
            or res.get("aff_short_url")
            or res.get("aff_url")
            or res.get("short_url")
            or ""
        )
        if not aff_url:
            code = res.get("code")
            err_msg = res.get("message") or res.get("error") or "Failed to generate link"
            err_str = str(err_msg)
            is_no_affiliate = (
                str(code) == "16666100"
                or "Affiliate Center" in err_str
                or "Precondition Required" in err_str
                or "not part of the campaign" in err_str.lower()
                or "DL005" in str(code)
            )
            return AffiliateLinkResult(
                platform=self.platform_name,
                request_id=actual_req_id,
                affiliate_url=None,
                is_ready=False,
                error="product_not_in_affiliate" if is_no_affiliate else err_str,
            )

        # 3. Parse metadata
        name = data_obj.get("product_name") or res.get("product_name") or "Sản phẩm TikTok Shop"
        img = data_obj.get("product_image") or data_obj.get("image") or res.get("product_image") or ""
        price_obj = data_obj.get("product_price") or res.get("product_price")
        price = _parse_amount(price_obj)
        price_fmt = _format_price(price_obj, price)

        comm_obj = data_obj.get("product_commission") or res.get("product_commission")
        raw_comm = _parse_amount(comm_obj)

        comm_rate_parsed = _parse_comm_rate(comm_obj.get("rate") if isinstance(comm_obj, dict) else None)
        comm_rate = comm_rate_parsed if comm_rate_parsed > 0 else ((raw_comm / price) if price > 0 else 0.10)

        # Sanity check: commission cannot exceed product price
        if price > 0 and comm_rate > 0:
            expected = price * comm_rate
            if raw_comm > price or (raw_comm > expected * 2.5 and raw_comm > 50000):
                raw_comm = round_dong(expected)

        net_comm = round_dong(raw_comm * (1 - 0.10))
        cb = round_dong(net_comm * advertised_rate)
        rate_pct = round(comm_rate * 100, 2)

        detail_json = json.dumps({
            "name": name,
            "price": price,
            "price_formatted": price_fmt,
            "commission": raw_comm,
            "total_rate": rate_pct,
            "shopee_rate": 0.0,
            "seller_rate": rate_pct,
            "shopee_part": 0,
            "seller_part": raw_comm,
            "is_capped": False,
            "net_commission": net_comm,
            "cashback": cb,
            "source": "accesstrade_tiktok",
            "image_url": img,
            "item_id": item_id,
        }, ensure_ascii=False)

        # 4. Save to link_requests
        if not existing:
            ledger.record_link_request(
                conn,
                request_id=actual_req_id,
                customer_id=customer_id,
                source_url=target_url,
                affiliate_url=aff_url,
                estimated_commission=raw_comm,
                channel="web",
                platform=self.platform_name,
            )
        else:
            conn.execute(
                "UPDATE link_requests SET affiliate_url = ?, estimated_commission = ?, status = 'converted' WHERE request_id = ?",
                (aff_url, raw_comm, actual_req_id),
            )

        conn.execute(
            "UPDATE link_requests SET estimate_detail = ?, estimate_source = 'accesstrade', status = 'ready' WHERE request_id = ?",
            (detail_json, actual_req_id),
        )
        conn.commit()

        # 5. Upsert products_cache
        ledger.upsert_product_cache(
            conn,
            item_id=f"tiktok_{item_id}",
            shop_id="tiktok_shop",
            name=name,
            price=price,
            price_formatted=price_fmt,
            shopee_rate=0.0,
            seller_rate=rate_pct,
            shopee_part=0,
            shopee_part_formatted="0đ",
            seller_part=raw_comm,
            seller_part_formatted=_vnd_format(raw_comm),
            total_commission=raw_comm,
            commission_formatted=_vnd_format(raw_comm),
            is_capped=False,
            cashback=cb,
            cashback_formatted=_vnd_format(cb),
            rate_percent=f"{advertised_rate:.0%}",
            affiliate_url=aff_url,
            canonical_url=target_url,
            image_url=img,
        )
        conn.commit()

        preview = ProductPreview(
            platform=self.platform_name,
            item_id=item_id,
            name=name,
            image_url=img,
            price=price,
            price_formatted=price_fmt,
            commission_rate=comm_rate,
            raw_commission=raw_comm,
            commission_formatted=_vnd_format(raw_comm),
            net_commission=net_comm,
            cashback_amount=cb,
            cashback_formatted=_vnd_format(cb),
            is_capped=False,
            canonical_url=target_url,
        )

        return AffiliateLinkResult(
            platform=self.platform_name,
            request_id=actual_req_id,
            affiliate_url=aff_url,
            is_ready=True,
            product_preview=preview,
            cached=False,
        )

    def search_products(
        self,
        keyword: str = "",
        limit: int = 5,
        sort_field: str = "units_sold",
    ) -> list[dict]:
        """Search TikTok Shop products via AccessTrade product feeds API.

        Returns list of dicts with keys: title, detail_link, price, commission_rate,
        commission_amount, image_url, units_sold, shop_name.
        """
        if not self.is_configured:
            return []

        auth_header = self._api_key
        if not auth_header.startswith("Token "):
            auth_header = f"Token {auth_header}"

        params: dict[str, Any] = {
            "sort_field": sort_field,
            "limit": limit,
        }
        if keyword:
            params["title_keywords"] = keyword

        endpoint = f"{self._base_url}/v1/tiktokshop_product_feeds"
        headers = {
            "Authorization": auth_header,
            "Content-Type": "application/json",
        }

        try:
            with httpx.Client(timeout=self._timeout) as client:
                resp = client.get(endpoint, headers=headers, params=params)
                resp.raise_for_status()
                data = resp.json()
        except Exception:
            return []

        # Response: {"data": {"products": [...], "next_page_token": "...", "total_count": N}, "status": true}
        data_obj = data.get("data", {})
        if isinstance(data_obj, dict):
            products_raw = data_obj.get("products", [])
        elif isinstance(data_obj, list):
            products_raw = data_obj
        else:
            return []

        results = []
        for p in products_raw:
            if not isinstance(p, dict):
                continue
            comm = p.get("commission", {}) or {}
            # commission.rate is in hundredths of percent: 1200 = 12.00%
            comm_rate_raw = comm.get("rate", 0) or 0
            comm_rate = comm_rate_raw / 10000  # convert to 0-1 decimal

            # Price: prefer original_price minimum_amount
            orig_price = p.get("original_price", {}) or {}
            price = _parse_amount(orig_price.get("minimum_amount") or orig_price.get("maximum_amount") or 0)

            comm_amount = _parse_amount(comm.get("amount", 0))

            results.append({
                "title": str(p.get("title", "")).strip(),
                "detail_link": p.get("detail_link", ""),
                "price": price,
                "price_formatted": _vnd_format(price) if price else "N/A",
                "commission_rate": comm_rate,
                "commission_rate_pct": round(comm_rate * 100, 1),
                "commission_amount": comm_amount,
                "image_url": p.get("main_image_url", ""),
                "units_sold": p.get("units_sold", 0),
                "shop_name": (p.get("shop", {}) or {}).get("name", ""),
                "product_id": p.get("id", ""),
            })
        return results

    def parse_orders(self, raw_data: Any) -> list[NormalizedOrder]:
        """Parse orders returned from AccessTrade Orders API (v1/orders or webhook)."""
        orders: list[NormalizedOrder] = []
        rows = []
        if isinstance(raw_data, dict):
            rows = raw_data.get("data") or raw_data.get("orders") or [raw_data]
        elif isinstance(raw_data, list):
            rows = raw_data

        for item in rows:
            if not isinstance(item, dict):
                continue
            order_id = str(item.get("order_id") or item.get("id") or "")
            if not order_id:
                continue

            customer_id = str(item.get("sub1") or item.get("sub_1") or item.get("customer_id") or "").strip()
            request_id = str(item.get("sub2") or item.get("sub_2") or item.get("request_id") or "").strip() or None
            order_val = _parse_amount(item.get("billing") or item.get("order_amount") or item.get("order_value") or item.get("price"))
            comm_val = _parse_amount(item.get("pub_commission") or item.get("commission"))

            # AccessTrade order status: 0/pending, 1/approved, 2/rejected
            raw_status = str(item.get("status") if item.get("status") is not None else item.get("order_status", "")).strip().lower()
            if raw_status in ("1", "approved", "success"):
                status = "approved"
                approved_comm = comm_val
            elif raw_status in ("2", "rejected", "canceled", "cancelled"):
                status = "rejected"
                approved_comm = None
            else:
                status = "awaiting_approval"
                approved_comm = None

            rejection_reason = item.get("reject_reason") or item.get("rejection_reason")
            order_time = str(item.get("created_time") or item.get("sale_time") or item.get("order_time") or item.get("created_at") or "")

            orders.append(
                NormalizedOrder(
                    order_id=order_id,
                    platform=self.platform_name,
                    customer_id=customer_id,
                    request_id=request_id,
                    order_value=order_val,
                    estimated_commission=comm_val,
                    approved_commission=approved_comm,
                    status=status,
                    rejection_reason=rejection_reason,
                    order_time=order_time,
                )
            )

        return orders
