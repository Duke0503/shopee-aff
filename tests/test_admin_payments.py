"""Tests for admin payment management, VietQR generation, and payout confirmation."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch
import pytest

from types import SimpleNamespace
from cashback.core import banks
from cashback.ledger import repository as ledger
from cashback.web.dashboard import _Handler


@pytest.fixture
def cfg(db):
    return SimpleNamespace(
        db_path=db,
        advertised_cashback_rate=0.80,
        reduced_cashback_rate=0.60,
        assistant_url="http://127.0.0.1:8891",
        assistant_token="dummy",
    )


class DummyRequest:
    def makefile(self, *args, **kwargs):
        import io
        return io.BytesIO()


@pytest.fixture
def mock_handler(cfg, conn):
    handler = _Handler.__new__(_Handler)
    handler.cfg = cfg
    handler.headers = {}
    handler.client_address = ("127.0.0.1", 12345)
    handler._client_ip = lambda: "127.0.0.1"
    handler._session_customer_info = lambda: ("admin1", {"role": "admin", "display_name": "Admin"})
    handler._json_sent = None

    def _json(payload, status=200):
        handler._json_sent = (payload, status)
        return payload

    handler._json = _json
    return handler


def test_admin_payments_query_and_vietqr(conn, cfg, mock_handler):
    # Customer 1: Valid bank (VCB)
    ledger.add_customer(conn, "C001", display_name="Nguyen Van A",
                        zalo_user_id="111", private_chat_id="111")
    conn.execute("UPDATE customers SET customer_code = 'DP00001' WHERE customer_id = 'C001'")
    ledger.set_bank_details(conn, "C001", "Vietcombank", "0123456789", "NGUYEN VAN A")
    ledger.add_order(conn, "ORD01", "C001", None, order_value=200_000, estimated_commission=30_000)
    ledger.mark_approved(conn, "ORD01", 30_000, 24_000)

    # Customer 2: Missing bank details
    ledger.add_customer(conn, "C002", display_name="Tran Thi B",
                        zalo_user_id="222", private_chat_id="222")
    conn.execute("UPDATE customers SET customer_code = 'DP00002' WHERE customer_id = 'C002'")
    ledger.add_order(conn, "ORD02", "C002", None, order_value=150_000, estimated_commission=20_000)
    ledger.mark_approved(conn, "ORD02", 20_000, 16_000)
    conn.execute("UPDATE orders SET settlement_status = 'settled'")
    conn.commit()

    res = mock_handler._admin_payments()
    assert res["ok"] is True
    assert "summary" in res
    assert "payables" in res

    payables = res["payables"]
    assert len(payables) == 2

    # Find C001
    c1 = next(p for p in payables if p["customer_id"] == "C001")
    assert c1["bank_status"] == "valid"
    assert c1["payable_amount"] == 24_000
    assert c1["qr_url"] is not None
    assert "vietqr.io" in c1["qr_url"]
    assert "0123456789" in c1["qr_url"]
    assert "24000" in c1["qr_url"]

    # Find C002
    c2 = next(p for p in payables if p["customer_id"] == "C002")
    assert c2["bank_status"] == "missing"
    assert c2["payable_amount"] == 16_000
    assert c2["qr_url"] is None


def test_admin_payment_confirm_records_transfer_and_marks_paid(conn, cfg, mock_handler):
    ledger.add_customer(conn, "C003", display_name="Le Van C",
                        zalo_user_id="333", private_chat_id="333")
    conn.execute("UPDATE customers SET customer_code = 'DP00003' WHERE customer_id = 'C003'")
    ledger.set_bank_details(conn, "C003", "MB Bank", "0987654321", "LE VAN C")
    ledger.add_order(conn, "ORD03", "C003", None, order_value=100_000, estimated_commission=15_000)
    ledger.mark_approved(conn, "ORD03", 15_000, 12_000)
    conn.commit()

    mock_handler._body = lambda: {
        "customer_id": "C003",
        "amount": 12_000,
        "order_ids": ["ORD03"],
        "transfer_code": "FT999",
        "note": "Chi trả tiền hoàn",
        "notify_mode": "both",
        "target_group": "test",
    }

    with patch("cashback.messaging.assistant_bridge.AssistantSender.send") as mock_send, \
         patch("cashback.messaging.assistant_bridge.AssistantSender.broadcast") as mock_bcast:
        res = mock_handler._admin_payment_confirm()
        assert res["ok"] is True
        assert res["marked_orders"] == 1

        mock_send.assert_called_once()
        recipient, dm_msg = mock_send.call_args[0]
        assert "12.000" in dm_msg
        assert "Xác nhận thanh toán thành công" in dm_msg
        assert "Số tiền" in dm_msg
        assert "Tổng đã nhận" in dm_msg
        assert "Bill" in dm_msg

        mock_bcast.assert_called_once()
        # Verify broadcast went to test group per user requirement
        _, bcast_kwargs = mock_bcast.call_args
        assert bcast_kwargs.get("group") == "test"

    # Verify order is marked paid
    with ledger.connect(cfg.db_path) as c:
        order = c.execute("SELECT status, paid_at FROM orders WHERE order_id = 'ORD03'").fetchone()
        assert order["status"] == "paid"
        assert order["paid_at"] is not None

        # Verify transfer in payment_transfers
        tx = c.execute("SELECT * FROM payment_transfers WHERE customer_id = 'C003'").fetchone()
        assert tx["amount"] == 12_000
        assert tx["notify_mode"] == "both"
        assert tx["target_group"] == "test"
        assert tx["transfer_code"] == "FT999"


def test_admin_payment_ask_bank(conn, cfg, mock_handler):
    ledger.add_customer(conn, "C004", display_name="Hoang Van D",
                        zalo_user_id="444", private_chat_id="444")
    conn.execute("UPDATE customers SET customer_code = 'DP00004' WHERE customer_id = 'C004'")
    conn.commit()

    mock_handler._body = lambda: {
        "customer_id": "C004",
        "custom_note": "Bạn nhớ gửi sớm nhé!",
    }

    with patch("cashback.messaging.assistant_bridge.AssistantSender.send") as mock_send:
        res = mock_handler._admin_payment_ask_bank()
        assert res["ok"] is True
        mock_send.assert_called_once()
        call_recipient, call_msg = mock_send.call_args[0]
        assert call_recipient == "444"
        assert "STK" in call_msg
        assert "Hoang Van D" in call_msg


def test_admin_upload_proof_gdrive(mock_handler):
    mock_handler._body = lambda: {
        "gdrive_url": "https://drive.google.com/file/d/12345/view",
    }
    res = mock_handler._admin_upload_proof()
    assert res["ok"] is True
    assert res["url"] == "https://drive.google.com/file/d/12345/view"


def test_admin_upload_proof_base64(mock_handler, monkeypatch):
    monkeypatch.setenv("GDRIVE_WEBHOOK_URL", "https://script.google.com/test")
    png_b64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    mock_handler._body = lambda *args, **kwargs: {
        "data": png_b64,
    }
    with patch("urllib.request.urlopen") as mock_url:
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({"drive_url": "https://drive.google.com/test"}).encode("utf-8")
        mock_url.return_value.__enter__.return_value = mock_resp
        res = mock_handler._admin_upload_proof()
        assert res["ok"] is True
        assert res["url"] == "https://drive.google.com/test"


def test_serve_bill_html(conn, cfg, mock_handler):
    ledger.add_customer(conn, "C005", display_name="Pham Thi E")
    conn.execute("UPDATE customers SET customer_code = 'DP00005' WHERE customer_id = 'C005'")
    cur = conn.execute("""
        INSERT INTO payment_transfers (customer_id, amount, transfer_code, note, proof_image, created_at)
        VALUES ('C005', 67164, 'DP00005TX', 'Hoan tien', 'https://example.com/proof.png', '2026-10-03 10:16:00')
    """)
    tx_id = cur.lastrowid
    conn.commit()

    mock_handler._send = lambda status, body, ct: (status, body.decode("utf-8"), ct)
    status, html_content, content_type = mock_handler._serve_bill(str(tx_id))
    assert status == 200
    assert "text/html" in content_type
    assert "67.164" in html_content
    assert "Pham Thi E" in html_content
    assert "Xác nhận thanh toán thành công" in html_content
    assert "https://example.com/proof.png" in html_content

    # Non-existent bill returns 404
    status_404, html_404, _ = mock_handler._serve_bill("999999")
    assert status_404 == 404
    assert "Không tìm thấy biên lai" in html_404


def test_payment_confirm_sets_notified_status_and_cashback(conn, cfg, mock_handler):
    ledger.add_customer(conn, "C009", display_name="Tran Van G", zalo_user_id="999", private_chat_id="999")
    ledger.add_order(conn, "ORD09", "C009", None, order_value=300_000, estimated_commission=30_000)
    conn.commit()
    # Order is in awaiting_approval (cashback_amount is None)
    ord_row = conn.execute("SELECT cashback_amount, status, notified_status FROM orders WHERE order_id = 'ORD09'").fetchone()
    assert ord_row["cashback_amount"] is None
    assert ord_row["notified_status"] is None

    mock_handler._body = lambda *args, **kwargs: {
        "customer_id": "C009",
        "amount": 21364,
        "order_ids": ["ORD09"],
        "notify_mode": "none",
    }
    res = mock_handler._admin_payment_confirm()
    assert res["ok"] is True

    # Order must now be marked paid, with notified_status='paid' and populated cashback_amount
    updated = conn.execute("SELECT status, notified_status, cashback_amount FROM orders WHERE order_id = 'ORD09'").fetchone()
    assert updated["status"] == "paid"
    assert updated["notified_status"] == "paid"
    assert updated["cashback_amount"] is not None
    assert updated["cashback_amount"] > 0


def test_announce_transfers_prevents_zero_dong(db):
    from cashback.messaging.notifications import _announce_transfers
    mock_bot = MagicMock()
    mock_bot.send.return_value = True

    # Dummy rows with 0 cashback
    rows = [{
        "order_id": "ORD_ZERO",
        "customer_id": "C_ZERO",
        "cashback_amount": 0,
        "estimated_commission": 0,
        "chat_id": "chat_zero",
        "bank_name": "VCB",
        "bank_account": "123",
        "account_holder": "USER",
        "customer_code": "DPZERO",
    }]
    sent = _announce_transfers(db, mock_bot, rows)
    assert sent == 0
    # Must NOT have sent any message with 0đ
    mock_bot.send.assert_not_called()

