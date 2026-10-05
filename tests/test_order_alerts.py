import pytest
from datetime import datetime
from cashback.core import telegram_alerts

def test_format_datetime():
    # ISO format with timezone
    assert telegram_alerts._format_datetime("2026-10-04T07:09:31+07:00") == "07:09:31 - 04/10/2026"
    # ISO format without tz
    assert telegram_alerts._format_datetime("2026-10-04T15:30:00") == "15:30:00 - 04/10/2026"
    # Space separated
    assert telegram_alerts._format_datetime("2026-10-04 15:42:26") == "15:42:26 - 04/10/2026"
    # Empty
    assert telegram_alerts._format_datetime(None) == "Chưa xác định"


def test_notify_order_alerts_sent(monkeypatch):
    sent = []
    monkeypatch.setattr(telegram_alerts, "send_telegram_message", lambda text, chat_id=None, parse_mode="HTML": sent.append(text))
    monkeypatch.setattr(telegram_alerts, "_send_async", lambda text, chat_id=None: sent.append(text))

    # 1. New order
    telegram_alerts.notify_new_order_received(
        order_id="261004PERGGE54",
        platform="shopee",
        customer_id="C001",
        customer_name="Nguyen Van A",
        order_value=30000,
        estimated_commission=2550,
        order_time="2026-10-04T07:09:31+07:00",
    )
    assert len(sent) == 1
    msg = sent[-1]
    assert "ĐƠN HÀNG MỚI GHI NHẬN" in msg
    assert "261004PERGGE54" in msg
    assert "Chờ duyệt" in msg
    assert "07:09:31 - 04/10/2026" in msg
    assert "Thời gian đặt hàng" in msg
    assert "Thời gian đồng bộ" in msg

    # 2. Order approved
    telegram_alerts.notify_order_approved(
        order_id="261004PERGGE54",
        platform="shopee",
        customer_id="C001",
        customer_name="Nguyen Van A",
        order_value=30000,
        approved_commission=2550,
        cashback_amount=2040,
        order_time="2026-10-04T07:09:31+07:00",
    )
    assert len(sent) == 2
    msg = sent[-1]
    assert "ĐƠN HÀNG ĐƯỢC DUYỆT THÀNH CÔNG" in msg
    assert "Đã duyệt" in msg
    assert "2.040đ" in msg
    assert "07:09:31 - 04/10/2026" in msg

    # 3. Order rejected
    telegram_alerts.notify_order_rejected(
        order_id="261004PERGGE54",
        platform="shopee",
        customer_id="C001",
        customer_name="Nguyen Van A",
        order_value=30000,
        reason="Khách hủy đơn trên sàn",
        order_time="2026-10-04T07:09:31+07:00",
    )
    assert len(sent) == 3
    msg = sent[-1]
    assert "ĐƠN HÀNG BỊ HỦY / TỪ CHỐI" in msg
    assert "Khách hủy đơn trên sàn" in msg
    assert "07:09:31 - 04/10/2026" in msg

    # 4. Order paid
    telegram_alerts.notify_order_paid(
        order_id="261004PERGGE54",
        platform="shopee",
        customer_id="C001",
        customer_name="Nguyen Van A",
        cashback_amount=2040,
        order_time="2026-10-04T07:09:31+07:00",
        note="CK VCB",
    )
    assert len(sent) == 4
    msg = sent[-1]
    assert "HOÀN TIỀN THÀNH CÔNG" in msg
    assert "Đã thanh toán" in msg
    assert "CK VCB" in msg
