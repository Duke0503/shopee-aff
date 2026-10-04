"""Telegram Alerting and Notification Module for Hoan Tien DP.

Routes messages to two distinct Telegram groups:
1. Dev Group (TELEGRAM_DEV_CHAT_ID):
   - Categorized Bug Reporting with 3 Severity Levels:
     🔴 CRITICAL: Dừng hệ thống, Shopee Captcha, hết session, sập Bridge, xung đột Zalo WebSocket, lỗi Database
     🟠 HIGH: Lỗi chức năng, AccessTrade API timeout, lỗi upload bill GDrive, 500 API errors
     🟡 WARNING: Cảnh báo mạng retry, hàng đợi dồn ứ, cảnh báo dữ liệu nghi ngờ
     ✅ RECOVERY: Khôi phục dịch vụ sau sự cố
   - Anti-spam cooldown per fingerprint & severity

2. Business Group (TELEGRAM_BUSINESS_CHAT_ID):
   - New members joining Zalo (member name, rank in group, total customer count)
   - New orders recorded (Shopee, TikTok Shop, Lazada, ShopeeFood, F&B)
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
import time
import urllib.request
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Optional

from .logging_setup import get_logger

log = get_logger(__name__)

# Cooldown durations by severity (in seconds)
COOLDOWN_BY_SEVERITY = {
    "CRITICAL": 300,   # 5 minutes
    "HIGH": 900,       # 15 minutes
    "WARNING": 1800,   # 30 minutes
}

# Default fallback cooldown
DEFAULT_COOLDOWN_SECONDS = 600

# Tracks the last time each alert fingerprint was sent: { fingerprint: timestamp }
_last_sent_timestamps: dict[str, float] = {}

# Tracks active failure states for recovery: { alert_type: bool }
_active_alert_states: dict[str, bool] = {}

_lock = threading.Lock()


def _read_env_value(key: str) -> str:
    val = os.getenv(key, "").strip()
    if val:
        return val
    env_file = Path(__file__).resolve().parents[3] / ".env"
    if env_file.exists():
        try:
            for line in env_file.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line.startswith(f"{key}=") and "=" in line:
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
        except Exception:
            pass
    return ""


def get_telegram_config() -> dict[str, str]:
    token = _read_env_value("TELEGRAM_BOT_TOKEN")
    default_chat = _read_env_value("TELEGRAM_CHAT_ID")
    dev_chat = _read_env_value("TELEGRAM_DEV_CHAT_ID") or default_chat
    business_chat = _read_env_value("TELEGRAM_BUSINESS_CHAT_ID") or default_chat
    return {
        "token": token,
        "dev_chat_id": dev_chat,
        "business_chat_id": business_chat,
    }


def send_telegram_message(text: str, chat_id: str | None = None, parse_mode: str = "HTML") -> bool:
    """Send a raw text message to a specific Telegram group."""
    cfg = get_telegram_config()
    token = cfg["token"]
    target_chat = chat_id or cfg["dev_chat_id"]

    if not token or not target_chat:
        log.warning("Telegram send skipped: Missing BOT_TOKEN or CHAT_ID.")
        return False

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": target_chat,
        "text": text,
        "parse_mode": parse_mode,
        "disable_web_page_preview": True,
    }

    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json", "User-Agent": "HoanTienDPAlertBot/1.0"},
        )
        ctx = None
        try:
            import certifi
            import ssl
            ctx = ssl.create_default_context(cafile=certifi.where())
        except Exception:
            ctx = None
        with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
            res_data = json.loads(resp.read().decode())
            if res_data.get("ok"):
                return True
            log.error(f"Telegram API responded with error: {res_data}")
            return False
    except Exception as exc:
        log.error(f"Failed to send Telegram message: {exc}")
        return False


def _send_async(text: str, chat_id: str | None = None) -> None:
    threading.Thread(target=send_telegram_message, args=(text, chat_id, "HTML"), daemon=True).start()


def _sanitize_html(text: str) -> str:
    """Escape special HTML characters for Telegram formatting."""
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


# =====================================================================
# UNIFIED CATEGORIZED BUG REPORTING (DEV DP GROUP)
# =====================================================================

def report_bug(
    title: str,
    details: str,
    severity: str = "HIGH",  # "CRITICAL" | "HIGH" | "WARNING"
    source: str = "",
    error_trace: str = "",
    action_needed: str = "",
    fingerprint: str = "",
    force: bool = False,
) -> bool:
    """
    Dispatch a categorized bug report to the Dev DP group.
    
    Severity Levels:
    - CRITICAL 🔴: Hệ thống tê liệt, Captcha, văng đăng nhập, sập Bridge, xung đột Zalo, hỏng DB.
    - HIGH 🟠: Lỗi chức năng, lỗi bên thứ 3 (AccessTrade/GDrive), lỗi 500 API.
    - WARNING 🟡: Cảnh báo mạng retry, hàng đợi tăng cao, bất thường nhẹ.
    """
    severity = severity.upper()
    if severity not in COOLDOWN_BY_SEVERITY:
        severity = "HIGH"

    # Compute fingerprint for deduplication
    if not fingerprint:
        fp_raw = f"{severity}:{source}:{title}:{details[:80]}"
        fingerprint = hashlib.md5(fp_raw.encode("utf-8")).hexdigest()

    cooldown = COOLDOWN_BY_SEVERITY.get(severity, DEFAULT_COOLDOWN_SECONDS)
    now = time.time()

    with _lock:
        last_sent = _last_sent_timestamps.get(fingerprint, 0.0)
        if not force and (now - last_sent < cooldown):
            log.info(f"Skipping [{severity}] bug alert '{title}' due to cooldown ({int(now - last_sent)}s / {cooldown}s).")
            return False

        _last_sent_timestamps[fingerprint] = now
        _active_alert_states[fingerprint] = True

    time_str = datetime.now().strftime("%H:%M:%S - %d/%m/%Y")
    clean_details = _sanitize_html(details)
    clean_source = _sanitize_html(source or "Backend Service")
    clean_title = _sanitize_html(title)

    # Format header & badge
    if severity == "CRITICAL":
        header = f"🚨🔴 <b>[BUG CRITICAL - KHẨN CẤP] {clean_title}</b>"
    elif severity == "HIGH":
        header = f"⚠️🟠 <b>[BUG HIGH - QUAN TRỌNG] {clean_title}</b>"
    else:
        header = f"⚠️🟡 <b>[CẢNH BÁO HỆ THỐNG - WARNING] {clean_title}</b>"

    lines = [
        header,
        f"\n📍 <b>Nguồn phát sinh:</b> <code>{clean_source}</code>",
        f"⏱ <b>Thời gian:</b> <code>{time_str}</code>",
        f"📝 <b>Chi tiết sự cố:</b>\n{clean_details}",
    ]

    if error_trace:
        clean_trace = _sanitize_html(error_trace[:1200])
        lines.append(f"\n📌 <b>Trace / Stacktrace:</b>\n<pre>{clean_trace}</pre>")

    if action_needed:
        clean_action = _sanitize_html(action_needed)
        lines.append(f"\n👉 <b>Hành động xử lý:</b>\n{clean_action}")

    msg = "\n".join(lines)
    cfg = get_telegram_config()
    _send_async(msg, cfg["dev_chat_id"])
    return True


def send_recovery(alert_key: str, title: str, details: str) -> bool:
    """Send a recovery message to Dev DP group if an alert was previously active."""
    with _lock:
        was_active = _active_alert_states.get(alert_key, False)
        _active_alert_states[alert_key] = False
        _last_sent_timestamps.pop(alert_key, None)

    if not was_active:
        return False

    time_str = datetime.now().strftime("%H:%M:%S - %d/%m/%Y")
    clean_title = _sanitize_html(title)
    clean_details = _sanitize_html(details)

    message = (
        f"✅ <b>[ĐÃ PHỤC HỒI] {clean_title}</b>\n\n"
        f"⏱ <b>Thời gian:</b> <code>{time_str}</code>\n"
        f"🎉 <b>Trạng thái:</b> {clean_details}\n"
        f"Hệ thống đã hoạt động bình thường trở lại."
    )

    cfg = get_telegram_config()
    _send_async(message, cfg["dev_chat_id"])
    return True


# =====================================================================
# SPECIALIZED TRIGGERS (Auto-mapped to severity)
# =====================================================================

def notify_shopee_captcha(hint: str = "", current_url: str = "") -> bool:
    return report_bug(
        title="Shopee dính Captcha Xác Minh (Slider/Traffic)",
        details=f"Trang tạo link Shopee Affiliate yêu cầu xác thực bảo mật.\nURL: {current_url or 'affiliate.shopee.vn/verify/...'}",
        severity="CRITICAL",
        source="shopee.link_generator",
        action_needed="Mở trình duyệt Google Chrome trên máy chạy Extension và thực hiện kéo thanh trượt / giải Captcha để tiếp tục tạo link.",
        fingerprint="shopee_captcha",
    )


def notify_shopee_session_expired(hint: str = "", current_url: str = "") -> bool:
    return report_bug(
        title="Shopee Hết Phiên Đăng Nhập / Đã Bị Đăng Xuất",
        details=f"Tab tạo link đã bị chuyển hướng về trang đăng nhập hoặc hết hạn token.\nURL: {current_url or 'passport.shopee.vn / login'}",
        severity="CRITICAL",
        source="shopee.link_generator",
        action_needed="Mở Google Chrome trên máy chủ, truy cập lại affiliate.shopee.vn và đăng nhập lại tài khoản Shopee Affiliate.",
        fingerprint="shopee_session",
    )


def notify_shopee_bridge_disconnected() -> bool:
    return report_bug(
        title="Mất Kết Nối Chrome Extension Shopee",
        details="Backend không thể kết nối tới Chrome Extension qua cổng WebSocket/Bridge (tab bị tắt hoặc Chrome bị đóng).",
        severity="CRITICAL",
        source="shopee.browser_bridge",
        action_needed="1. Kiểm tra xem Chrome có đang mở không.\n2. Đảm bảo tab Shopee Affiliate vẫn đang chạy và Extension đã bật kết nối Bridge.",
        fingerprint="shopee_bridge",
    )


def notify_zalo_websocket_conflict(reconnect_count: int = 3, reason: str = "") -> bool:
    return report_bug(
        title="Zalo Bot Tranh Chấp WebSocket / Văng Kết Nối",
        details=(
            f"Phát hiện WebSocket Zalo bị ngắt kết nối dồn dập ({reconnect_count} lần trong 1 phút).\n"
            f"Nguyên nhân: {reason or 'Hai worker cùng kết nối hoặc bị đăng nhập đè'}"
        ),
        severity="CRITICAL",
        source="zalo_assistant/assistant_worker.js",
        action_needed=(
            "1. Kiểm tra xem có 2 tiến trình assistant_worker.js đang chạy cùng lúc không.\n"
            "2. Kiểm tra xem tài khoản Zalo bot có vừa đăng nhập nơi khác không.\n"
            "3. Tắt bớt tiến trình thừa để tránh bị khóa session."
        ),
        fingerprint="zalo_conflict",
    )


def notify_database_error(error_msg: str, trace: str = "") -> bool:
    return report_bug(
        title="Lỗi Kết Nối Cơ Sở Dữ Liệu (Turso / SQLite)",
        details=f"Không thể thực hiện truy vấn cơ sở dữ liệu: {error_msg}",
        severity="CRITICAL",
        source="ledger.repository",
        error_trace=trace,
        action_needed="Kiểm tra token Turso Cloud hoặc file cashback.db xem có bị lock/hết hạn không.",
        fingerprint="database_error",
    )


def notify_shopee_recovered() -> bool:
    return (
        send_recovery("shopee_captcha", "Tạo Link Shopee Hoạt Động Bình Thường", "Các link Shopee Affiliate đã được tạo thành công.")
        or send_recovery("shopee_session", "Tạo Link Shopee Hoạt Động Bình Thường", "Phiên đăng nhập Shopee đã khôi phục.")
        or send_recovery("shopee_bridge", "Kết Nối Chrome Extension Đã Phục Hồi", "Chrome Extension Shopee đã kết nối lại với Backend.")
    )


def notify_zalo_recovered() -> bool:
    return send_recovery(
        "zalo_conflict",
        "WebSocket Zalo Bot Đã Ổn Định",
        "Kết nối WebSocket Zalo đã duy trì ổn định không còn bị xung đột.",
    )


# =====================================================================
# BUSINESS NOTIFICATIONS (DP BUSINESS GROUP)
# =====================================================================

def notify_new_member_joined(
    display_name: str,
    member_rank: int,
    group_name: str = "Hoàn Tiền Shopee",
    total_customers: int = 0,
    zalo_uid: str = "",
) -> bool:
    """Notify DP Business group whenever a new member joins the Zalo group."""
    time_str = datetime.now().strftime("%H:%M:%S - %d/%m/%Y")
    clean_name = _sanitize_html(display_name)
    clean_group = _sanitize_html(group_name)

    lines = [
        "🎉 <b>[THÀNH VIÊN MỚI GIA NHẬP ZALO]</b>\n",
        f"👤 <b>Tên:</b> <b>{clean_name}</b>",
        f"👥 <b>Thứ tự trong nhóm:</b> Là thành viên thứ <b>#{member_rank}</b> của nhóm <i>{clean_group}</i>",
    ]
    if total_customers > 0:
        lines.append(f"🌐 <b>Tổng khách hệ thống:</b> <b>{total_customers}</b> khách hàng")
    if zalo_uid:
        lines.append(f"🆔 <b>Zalo UID:</b> <code>{zalo_uid}</code>")
    lines.append(f"⏱ <b>Thời gian:</b> <code>{time_str}</code>")

    cfg = get_telegram_config()
    _send_async("\n".join(lines), cfg["business_chat_id"])
    return True


def notify_new_order_received(
    order_id: str,
    platform: str,
    customer_id: str | None = None,
    customer_name: str | None = None,
    order_value: int | None = None,
    estimated_commission: int | None = None,
    cashback_amount: int | None = None,
) -> bool:
    """Notify DP Business group about a new order recorded."""
    time_str = datetime.now().strftime("%H:%M:%S - %d/%m/%Y")
    platform_icon = {
        "shopee": "🟠 Shopee",
        "tiktok": "⚫ TikTok Shop",
        "lazada": "🔵 Lazada",
        "shopeefood": "🍔 ShopeeFood",
        "fnb": "☕ F&B Voucher",
    }.get(platform.lower(), f"🛒 {platform.title()}")

    lines = [
        f"🛒 <b>[ĐƠN HÀNG MỚI PHÁT SINH] {platform_icon}</b>\n",
        f"📦 <b>Mã đơn hàng:</b> <code>{order_id}</code>",
    ]

    cust_display = customer_name or customer_id or "Chưa gắn mã (Khách vãng lai)"
    if customer_id and customer_name and customer_name != customer_id:
        cust_display = f"{customer_name} (ID: {customer_id})"
    lines.append(f"👤 <b>Khách hàng:</b> {_sanitize_html(cust_display)}")

    if order_value:
        lines.append(f"💰 <b>Giá trị đơn hàng:</b> <b>{order_value:,.0f}đ</b>".replace(",", "."))
    if estimated_commission:
        lines.append(f"💵 <b>Hoa hồng dự kiến:</b> <b>{estimated_commission:,.0f}đ</b>".replace(",", "."))
    if cashback_amount:
        lines.append(f"🎁 <b>Hoàn tiền tạm tính:</b> <b>{cashback_amount:,.0f}đ</b>".replace(",", "."))
    elif estimated_commission:
        est_cb = round(estimated_commission * 0.8)
        lines.append(f"🎁 <b>Hoàn tiền tạm tính (80%):</b> <b>{est_cb:,.0f}đ</b>".replace(",", "."))

    lines.append(f"⏱ <b>Thời gian:</b> <code>{time_str}</code>")

    cfg = get_telegram_config()
    _send_async("\n".join(lines), cfg["business_chat_id"])
    return True
