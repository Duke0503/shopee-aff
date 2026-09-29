"""Unit tests for F&B vouchers system (Highlands Coffee & The Coffee House).

Tests:
1. Brand normalization
2. AccessTrade link generation with fallback
3. Daily 8:30 AM announcement formatting (3-step guide, weekday branch, no ShopeeFood)
4. Order normalization for Highlands and The Coffee House transactions
5. System key-value state persistence
"""

from __future__ import annotations

from datetime import datetime, timezone, timedelta
import pytest

from cashback.ledger import repository as ledger
from cashback.providers.accesstrade_reconciler import normalize_transactions, sync_accesstrade_orders
from cashback.providers.fnb_provider import (
    create_fnb_link,
    build_fnb_daily_announcement,
    normalize_fnb_brand,
    HIGHLANDS_DEFAULT_SHORT,
    TCH_DEFAULT_SHORT,
)


class TestFnbProvider:
    def test_brand_normalization(self):
        assert normalize_fnb_brand("highlands") == "highlands"
        assert normalize_fnb_brand("Highland_Antsomi_Zalo") == "highlands"
        assert normalize_fnb_brand("tch") == "thecoffeehouse"
        assert normalize_fnb_brand("thecoffeehouse_cpv") == "thecoffeehouse"
        assert normalize_fnb_brand("The Coffee House") == "thecoffeehouse"

    def test_create_link_fallback_without_api_key(self):
        res_hl = create_fnb_link(api_key="", brand="highlands", customer_id="user123")
        assert res_hl["ok"] is True
        assert res_hl["brand"] == "highlands"
        assert res_hl["short_link"] == HIGHLANDS_DEFAULT_SHORT
        assert res_hl["fallback"] is True

        res_tch = create_fnb_link(api_key="", brand="thecoffeehouse", customer_id="user123")
        assert res_tch["ok"] is True
        assert res_tch["brand"] == "thecoffeehouse"
        assert res_tch["short_link"] == TCH_DEFAULT_SHORT
        assert res_tch["fallback"] is True

    def test_announcement_contains_3_step_guide_and_no_shopeefood_and_no_830(self):
        # Tuesday (weekday = 1) -> Mua 1 Tặng 1
        tue_dt = datetime(2026, 9, 29, 8, 30, tzinfo=timezone(timedelta(hours=7)))
        tue_msg = build_fnb_daily_announcement(
            tue_dt,
            highlands_vouchers=[{"title": "Mua 1 Tặng 1", "code": "HLM1T1"}],
            tch_vouchers=[{"title": "Giảm 20%", "discount_text": "20%"}],
        )

        assert "ƯU ĐÃI CÀ PHÊ & TRÀ HÔM NAY" in tue_msg
        assert "Thứ Ba" in tue_msg
        assert "8:30" not in tue_msg  # 8:30 removed as requested
        assert "[8:30 AM]" not in tue_msg
        assert "HLM1T1" in tue_msg
        assert "Giảm 20%" in tue_msg
        assert "HƯỚNG DẪN 3 BƯỚC DÙNG TẠI QUẦY & NHẬN HOÀN TIỀN" in tue_msg
        assert "1️⃣ Lấy mã" in tue_msg
        assert "2️⃣ Áp dụng" in tue_msg
        assert "3️⃣ Nhận tiền hoàn" in tue_msg
        assert "/highlands" in tue_msg
        assert "/tch" in tue_msg
        assert "ShopeeFood" not in tue_msg  # ShopeeFood excluded

        # Friday (weekday = 4) -> Daily combo without specific vouchers
        fri_dt = datetime(2026, 10, 2, 8, 30, tzinfo=timezone(timedelta(hours=7)))
        fri_msg = build_fnb_daily_announcement(fri_dt, highlands_vouchers=[], tch_vouchers=[])

        assert "Thứ Sáu" in fri_msg
        assert "8:30" not in fri_msg
        assert "HƯỚNG DẪN 3 BƯỚC DÙNG TẠI QUẦY & NHẬN HOÀN TIỀN" in fri_msg
        assert "ShopeeFood" not in fri_msg
        assert "Mini App Highlands trên Zalo" in fri_msg


class TestFnbReconciliation:
    def test_highlands_transaction_identified_correctly(self):
        lines = [{
            "transaction_id": "HL_TX_1001",
            "merchant": "highland_antsomi_zalo",
            "status": 0,
            "is_confirmed": 0,
            "transaction_time": "2026-09-29T09:00:00",
            "reason_rejected": "",
            "product_quantity": 1,
            "product_price": 0.0,
            "commission": 9000.0,
            "transaction_value": 0.0,
            "_extra": {"sub_params": {"sub1": "user_hl", "sub2": ""}},
        }]
        orders = normalize_transactions(lines)
        assert len(orders) == 1
        order = orders[0]
        assert order.platform == "highlands"
        assert order.order_id == "HL_TX_1001"
        assert order.customer_id == "user_hl"
        assert order.estimated_commission == 9000
        # Value falls back to commission when product_price and transaction_value are 0
        assert order.order_value == 9000

    def test_tch_transaction_identified_correctly(self):
        lines = [{
            "transaction_id": "TCH_TX_2001",
            "merchant": "thecoffeehouse_cpv",
            "status": 1,
            "is_confirmed": 1,
            "transaction_time": "2026-09-29T09:15:00",
            "reason_rejected": "",
            "product_quantity": 1,
            "product_price": 0.0,
            "commission": 10500.0,
            "transaction_value": 0.0,
            "_extra": {"sub_params": {"sub1": "user_tch", "sub2": ""}},
        }]
        orders = normalize_transactions(lines)
        assert len(orders) == 1
        order = orders[0]
        assert order.platform == "thecoffeehouse"
        assert order.status == "approved"
        assert order.approved_commission == 10500


class TestSystemKv:
    def test_system_kv_storage(self, db):
        with ledger.connect(db) as conn:
            ledger.set_system_kv(conn, "last_fnb_broadcast_date", "2026-09-29")
            val = ledger.get_system_kv(conn, "last_fnb_broadcast_date")
            assert val == "2026-09-29"

            # Update existing
            ledger.set_system_kv(conn, "last_fnb_broadcast_date", "2026-09-30")
            assert ledger.get_system_kv(conn, "last_fnb_broadcast_date") == "2026-09-30"

            # Non-existent key
            assert ledger.get_system_kv(conn, "non_existent") is None
            assert ledger.get_system_kv(conn, "non_existent", "default_val") == "default_val"
