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

    # 5. Duplicate test: calling notify_new_order_received or mark_approved again should be SUPPRESSED
    res1 = telegram_alerts.notify_new_order_received(
        order_id="261004PERGGE54",
        platform="shopee",
    )
    assert res1 is False
    assert len(sent) == 4  # No new message sent

    res2 = telegram_alerts.notify_order_approved(
        order_id="261004PERGGE54",
        platform="shopee",
    )
    assert res2 is False
    assert len(sent) == 4  # Still no new message sent


def test_repository_order_deduplication(conn, customer, monkeypatch):
    from cashback.ledger import repository as ledger
    sent = []
    monkeypatch.setattr(telegram_alerts, "_send_async", lambda text, chat_id=None: sent.append(text))
    # Clear in-memory cache to isolate repository check
    telegram_alerts._notified_order_fingerprints.clear()

    # 1. Add order first time
    ledger.add_order(
        conn,
        order_id="TEST_ORD_01",
        customer_id=customer,
        request_id=None,
        order_value=100000,
        estimated_commission=10000,
        platform="shopee",
        recorded_at="2026-10-04T10:00:00+07:00",
    )
    assert len(sent) == 1
    assert "TEST_ORD_01" in sent[-1]
    assert "Chờ duyệt" in sent[-1]

    # Verify telegram_order_alerts table
    row = conn.execute(
        "SELECT * FROM telegram_order_alerts WHERE order_id=? AND status=?",
        ("TEST_ORD_01", ledger.AWAITING_APPROVAL),
    ).fetchone()
    assert row is not None

    # Verify should_notify_telegram_order is now False
    assert ledger.should_notify_telegram_order(conn, "TEST_ORD_01", ledger.AWAITING_APPROVAL) is False

    # 2. Mark approved
    telegram_alerts._notified_order_fingerprints.clear()
    ok = ledger.mark_approved(conn, "TEST_ORD_01", approved_commission=10000, cashback_amount=8000)
    assert ok is True
    assert len(sent) == 2
    assert "Đã duyệt" in sent[-1]

    # Verify approved alert is recorded
    assert ledger.should_notify_telegram_order(conn, "TEST_ORD_01", ledger.APPROVED) is False

    # 3. Simulate another call or restart: calling mark_approved again
    telegram_alerts._notified_order_fingerprints.clear()
    # Even if mark_approved was invoked again, should_notify_telegram_order prevents alert
    assert ledger.should_notify_telegram_order(conn, "TEST_ORD_01", ledger.APPROVED) is False

    # 4. Mark paid
    telegram_alerts._notified_order_fingerprints.clear()
    ok_paid = ledger.mark_paid(conn, "TEST_ORD_01", note="Paid via banking")
    assert ok_paid is True
    assert len(sent) == 3
    assert "HOÀN TIỀN THÀNH CÔNG" in sent[-1]

    # Verify paid alert recorded
    assert ledger.should_notify_telegram_order(conn, "TEST_ORD_01", ledger.PAID) is False

