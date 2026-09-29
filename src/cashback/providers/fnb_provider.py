"""F&B Affiliate Provider for Highlands Coffee and The Coffee House.

Handles personalized affiliate link generation via AccessTrade Open API,
daily 8:30 AM promotional broadcast copy with 3-step redemption guide,
and fallback short links for in-store voucher redemption.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import httpx

log = logging.getLogger(__name__)

# AccessTrade Campaign IDs and destination URLs
HIGHLANDS_CAMPAIGN_ID = "6709203674879803188"
HIGHLANDS_URL = "https://zalo.me/s/327411629127312067/games/affiliate"
HIGHLANDS_DEFAULT_SHORT = "https://shorten.asia/ay4B1J76"
HIGHLANDS_MERCHANT = "highland_antsomi_zalo"

TCH_CAMPAIGN_ID = "6699917486599106569"
TCH_URL = "https://promothecoffeeehouse.com.vn/"
TCH_DEFAULT_SHORT = "https://shorten.asia/hd1SKkKf"
TCH_MERCHANT = "thecoffeehouse_cpv"


def normalize_fnb_brand(brand: str) -> str:
    """Normalize user input or merchant name to 'highlands' or 'thecoffeehouse'."""
    b = (brand or "").strip().lower().replace(" ", "").replace("_", "")
    if "highland" in b:
        return "highlands"
    if "coffeehouse" in b or "tch" in b:
        return "thecoffeehouse"
    return b


def create_fnb_link(
    api_key: str,
    brand: str,
    customer_id: str,
    request_id: Optional[str] = None,
    base_url: str = "https://api.accesstrade.vn",
    timeout: float = 12.0,
) -> dict[str, Any]:
    """Generate a personalized affiliate link for Highlands Coffee or The Coffee House.

    Args:
        api_key: AccessTrade API key (starts with 'Token ' or raw key)
        brand: 'highlands' or 'thecoffeehouse'
        customer_id: Customer identifier (sub1) for tracking & cashback attribution
        request_id: Optional tracking request id (sub2)
        base_url: AccessTrade API base url
        timeout: HTTP request timeout in seconds

    Returns:
        dict with keys: ok (bool), brand (str), short_link (str), aff_link (str), fallback (bool)
    """
    norm_brand = normalize_fnb_brand(brand)

    if norm_brand == "highlands":
        campaign_id = HIGHLANDS_CAMPAIGN_ID
        dest_url = HIGHLANDS_URL
        default_short = HIGHLANDS_DEFAULT_SHORT
    elif norm_brand == "thecoffeehouse":
        campaign_id = TCH_CAMPAIGN_ID
        dest_url = TCH_URL
        default_short = TCH_DEFAULT_SHORT
    else:
        # Default to Highlands
        norm_brand = "highlands"
        campaign_id = HIGHLANDS_CAMPAIGN_ID
        dest_url = HIGHLANDS_URL
        default_short = HIGHLANDS_DEFAULT_SHORT

    if not api_key:
        return {
            "ok": True,
            "brand": norm_brand,
            "short_link": default_short,
            "aff_link": default_short,
            "fallback": True,
        }

    auth_header = api_key if api_key.startswith("Token ") else f"Token {api_key}"
    headers = {
        "Authorization": auth_header,
        "Content-Type": "application/json",
        "User-Agent": "CashbackBot/1.0",
    }
    payload = {
        "campaign_id": campaign_id,
        "urls": [dest_url],
        "sub1": str(customer_id or "anonymous").strip(),
        "sub2": str(request_id or "").strip(),
        "sub3": "cashback_fnb",
        "utm_source": "cashback_bot",
    }
    endpoint = f"{base_url.rstrip('/')}/v1/product_link/create"

    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(endpoint, json=payload, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, dict):
                    data_obj = data.get("data")
                    success_links = []
                    if isinstance(data_obj, dict):
                        success_links = data_obj.get("success_link") or []
                    elif isinstance(data_obj, list):
                        success_links = data_obj

                    if success_links and isinstance(success_links, list):
                        first = success_links[0]
                        short_link = first.get("short_link") or first.get("short_url") or default_short
                        aff_link = first.get("aff_link") or first.get("url") or short_link
                        return {
                            "ok": True,
                            "brand": norm_brand,
                            "short_link": short_link,
                            "aff_link": aff_link,
                            "fallback": False,
                        }
            log.warning(f"AccessTrade F&B link API returned {resp.status_code}: {resp.text}")
    except Exception as exc:
        log.error(f"Error calling AccessTrade F&B link create API for {norm_brand}: {exc}")

    return {
        "ok": True,
        "brand": norm_brand,
        "short_link": default_short,
        "aff_link": default_short,
        "fallback": True,
    }


def build_fnb_daily_announcement(
    dt: Optional[datetime] = None,
    custom_highlands_link: Optional[str] = None,
    custom_tch_link: Optional[str] = None,
) -> str:
    """Build the official 8:30 AM daily announcement for Highlands & The Coffee House.

    Includes brand vouchers, 3-step redemption guide, and direct instructions.
    On Tuesdays and Thursdays, highlights Highlands' Buy 1 Get 1 (M1T1) opening.
    """
    if dt is None:
        tz_vn = timezone(timedelta(hours=7))
        dt = datetime.now(tz_vn)

    hl_link = custom_highlands_link or HIGHLANDS_DEFAULT_SHORT
    tch_link = custom_tch_link or TCH_DEFAULT_SHORT

    # Weekday in VN: 0 = Mon, 1 = Tue, 2 = Wed, 3 = Thu, 4 = Fri, 5 = Sat, 6 = Sun
    weekday = dt.weekday()
    day_names = ["Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ Nhật"]
    day_str = day_names[weekday]

    is_m1t1_day = weekday in (1, 3)  # Tuesday or Thursday

    if is_m1t1_day:
        header = f"🔥 [8:30 AM] SĂN VOUCHER MUA 1 TẶNG 1 HIGHLANDS & GIẢM 20% THE COFFEE HOUSE! ☕🏠\n\n"
        intro = (
            f"Chào cả nhà buổi sáng! Hôm nay là {day_str}, Highlands Coffee vừa mở cổng phát voucher "
            f"MUA 1 TẶNG 1 và The Coffee House tung hàng loạt ưu đãi đồ uống giảm giá sâu:\n\n"
        )
        hl_vouchers = (
            f"☕ HIGHLANDS COFFEE (Cổng mở lúc 8:30 sáng nay):\n"
            f"• 🎁 MUA 1 TẶNG 1 (Trà sen vàng / Freeze / Phindi size L tặng S/M)\n"
            f"• 🏷️ Giảm 30.000đ cho hóa đơn từ 99.000đ\n"
            f"• 🥐 Combo Cà phê phin + Bánh chỉ từ 39.000đ\n\n"
        )
    else:
        header = f"☕ [8:30 AM] ƯU ĐÃI CÀ PHÊ & TRÀ SÁNG NAY: HIGHLANDS COFFEE & THE COFFEE HOUSE 🎁\n\n"
        intro = (
            f"Chào cả nhà buổi sáng {day_str}! Khởi đầu ngày mới tỉnh táo và tiết kiệm "
            f"với loạt ưu đãi dùng tại quầy cực hot hôm nay:\n\n"
        )
        hl_vouchers = (
            f"☕ HIGHLANDS COFFEE:\n"
            f"• 🏷️ Giảm 30.000đ cho hóa đơn từ 99.000đ\n"
            f"• 🥐 Combo Cà phê phin + Bánh chỉ từ 39.000đ\n"
            f"• 🎁 Tặng 1 ly cùng size khi mua hóa đơn từ 119.000đ\n\n"
        )

    tch_vouchers = (
        f"🏠 THE COFFEE HOUSE:\n"
        f"• 🏷️ Giảm 20% toàn bộ đồ uống trên menu\n"
        f"• 🎁 Mua 2 Tặng 1 Trà sữa & Macchiato\n"
        f"• 🍿 Combo Nước + Bánh/Snack chỉ 49.000đ\n\n"
    )

    steps_guide = (
        f"━━━━━━━━━━━━━━━━━━━\n"
        f"📋 HƯỚNG DẪN 3 BƯỚC DÙNG TẠI QUẦY & NHẬN HOÀN TIỀN:\n"
        f"1️⃣ Lấy mã: Nhắn riêng cho bot hoặc gõ /highlands hay /tch -> Bấm link nhận mã mở Mini App Zalo / Web -> Bấm 'Lưu mã' để hiện mã vạch (Barcode/QR).\n"
        f"2️⃣ Áp dụng: Đưa mã vạch trên màn hình điện thoại cho thu ngân quét trước khi thanh toán tiền tại quầy.\n"
        f"3️⃣ Nhận tiền hoàn: Hóa đơn được giảm giá ngay lập tức + Tự động tích lũy ~7.000đ - 8.000đ hoàn tiền vào tài khoản bot! (Gõ /sodu để kiểm tra).\n\n"
    )

    call_to_action = (
        f"👉 Nhắn tin cho bot hoặc gõ lệnh để nhận link voucher cá nhân (tự động cộng tiền hoàn vào tài khoản Zalo của bạn):\n"
        f"• Gõ: /highlands\n"
        f"• Gõ: /tch\n\n"
        f"🔗 Hoặc bấm nhận nhanh ngay tại đây:\n"
        f"• Highlands Coffee: {hl_link}\n"
        f"• The Coffee House: {tch_link}"
    )

    return header + intro + hl_vouchers + tch_vouchers + steps_guide + call_to_action
