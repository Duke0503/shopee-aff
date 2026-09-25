import json
from pathlib import Path
import pytest

from cashback.providers.registry import get_registry, ProviderRegistry
from cashback.providers.shopee_provider import ShopeeProvider
from cashback.providers.tiktok_provider import TikTokAccessTradeProvider
from cashback.ledger import repository as ledger


@pytest.fixture
def test_db(tmp_path):
    db_file = tmp_path / "test_cashback.db"
    ledger.initialise(db_file)
    with ledger.connect(db_file) as conn:
        ledger.add_customer(conn, "C_TEST", display_name="Test User")
        conn.commit()
    return db_file


def test_registry_registration_and_detection():
    reg = get_registry()
    shopee_p = reg.get_by_name("shopee")
    tiktok_p = reg.get_by_name("tiktok")
    lazada_p = reg.get_by_name("lazada")
    shopeefood_p = reg.get_by_name("shopeefood")

    assert shopee_p is not None
    assert tiktok_p is not None
    assert lazada_p is not None
    assert shopeefood_p is not None

    # Shopee URLs
    assert reg.detect_provider("https://shopee.vn/product/123/456") == shopee_p
    assert reg.detect_provider("https://vn.shp.ee/ABCD123") == shopee_p
    assert reg.detect_provider("https://s.shopee.vn/test") == shopee_p

    # TikTok URLs
    assert reg.detect_provider("https://vt.tiktok.com/ZSBKCcJrf/") == tiktok_p
    assert reg.detect_provider("https://shop.tiktok.com/view/product/1729384") == tiktok_p
    assert reg.detect_provider("https://www.tiktok.com/@user/video/123456789") == tiktok_p

    # Lazada URLs
    assert reg.detect_provider("https://www.lazada.vn/products/tai-nghe-bluetooth-i123456789.html") == lazada_p
    assert reg.detect_provider("https://s.lazada.vn/s.test123") == lazada_p

    # ShopeeFood URLs
    assert reg.detect_provider("https://shopeefood.vn/ho-chi-minh/tra-sua-gong-cha") == shopeefood_p
    assert reg.detect_provider("https://food.shopee.vn/ha-noi/bun-cha-huong-lien") == shopeefood_p
    assert reg.detect_provider("https://shopee.vn/now-food/da-nang/banh-mi-ba-lan") == shopeefood_p

    # Unsupported URLs
    assert reg.detect_provider("https://google.com") is None
    assert reg.detect_provider("https://amazon.com/dp/B08N5WRWNW") is None


def test_tiktok_provider_preview_simulated(monkeypatch):
    provider = TikTokAccessTradeProvider()
    monkeypatch.setattr(
        provider,
        "_call_accesstrade_create_link",
        lambda product_url, customer_id="", request_id="": {
            "status": True,
            "aff_short_url": "https://shorten.accesstrade.vn/t/abc",
            "product_name": "Áo thun nam TikTok Shop",
            "product_price": {"amount": 150000},
            "product_commission": {"amount": 15000},
        },
    )
    preview = provider.preview("https://vt.tiktok.com/ZSBKCcJrf/", advertised_rate=0.80)

    assert preview is not None
    assert preview.platform == "tiktok"
    assert preview.price > 0
    assert preview.raw_commission > 0
    assert preview.cashback_amount > 0
    assert "đ" in preview.price_formatted
    assert "đ" in preview.cashback_formatted


def test_tiktok_provider_create_link(test_db, monkeypatch):
    provider = TikTokAccessTradeProvider()
    monkeypatch.setattr(
        provider,
        "_call_accesstrade_create_link",
        lambda product_url, customer_id="", request_id="": {
            "status": True,
            "aff_short_url": f"https://shorten.accesstrade.vn/t/mock_{request_id}",
            "product_name": "Áo thun nam TikTok Shop",
            "product_price": {"amount": 150000},
            "product_commission": {"amount": 15000},
        },
    )
    with ledger.connect(test_db) as conn:
        res = provider.create_link(
            url="https://vt.tiktok.com/ZSBKCcJrf/",
            customer_id="C_TEST",
            request_id="R_TIKTOK_01",
            conn=conn,
            advertised_rate=0.80,
        )

    assert res.platform == "tiktok"
    assert res.is_ready is True
    assert res.affiliate_url is not None
    assert "accesstrade" in res.affiliate_url or "tiktok" in res.affiliate_url

    with ledger.connect(test_db) as conn:
        row = conn.execute("SELECT * FROM link_requests WHERE request_id = 'R_TIKTOK_01'").fetchone()
        assert row is not None
        assert row["platform"] == "tiktok"
        assert row["affiliate_url"] == res.affiliate_url


def test_tiktok_provider_parse_orders():
    provider = TikTokAccessTradeProvider()
    raw_api_response = {
        "status": True,
        "data": [
            {
                "order_id": "TT_ORDER_001",
                "sub1": "C_TEST",
                "sub2": "R_TIKTOK_01",
                "order_value": 300000,
                "commission": 30000,
                "order_status": 1,
                "order_time": "2026-09-22 09:00:00",
            },
            {
                "order_id": "TT_ORDER_002",
                "sub1": "C_TEST",
                "sub2": "R_TIKTOK_02",
                "order_value": 500000,
                "commission": 50000,
                "order_status": 2,
                "reject_reason": "Customer cancelled order",
                "order_time": "2026-09-22 09:30:00",
            },
        ]
    }

    orders = provider.parse_orders(raw_api_response)
    assert len(orders) == 2

    o1 = orders[0]
    assert o1.order_id == "TT_ORDER_001"
    assert o1.platform == "tiktok"
    assert o1.customer_id == "C_TEST"
    assert o1.status == "approved"
    assert o1.approved_commission == 30000

    o2 = orders[1]
    assert o2.order_id == "TT_ORDER_002"
    assert o2.platform == "tiktok"
    assert o2.status == "rejected"
    assert o2.rejection_reason == "Customer cancelled order"


def test_sync_accesstrade_orders_reconciliation(test_db):
    from cashback.core.config import load
    from cashback.providers.accesstrade_reconciler import sync_accesstrade_orders

    cfg = load()
    object.__setattr__(cfg, "db_path", test_db)

    # The sync never invents a customer from a sub1 it does not know.
    with ledger.connect(test_db) as conn:
        ledger.add_customer(conn, "C_TEST", zalo_user_id="C_TEST")

    raw_orders = [
        {
            "order_id": "TT_REC_01",
            "sub1": "C_TEST",
            "sub2": "R_01",
            "order_value": 200000,
            "commission": 20000,
            "order_status": 1,
            "order_time": "2026-09-22 10:00:00",
        },
        {
            "order_id": "TT_REC_02",
            "sub1": "C_TEST",
            "sub2": "R_02",
            "order_value": 400000,
            "commission": 40000,
            "order_status": 2,
            "reject_reason": "Order refunded",
            "order_time": "2026-09-22 10:30:00",
        },
    ]

    summary = sync_accesstrade_orders(cfg, raw_orders=raw_orders)
    assert summary.rows_read == 2
    assert summary.orders_new == 2
    assert summary.approved == 1
    assert summary.rejected == 1

    with ledger.connect(test_db) as conn:
        o1 = ledger.get_order(conn, "TT_REC_01")
        assert o1 is not None
        assert o1["platform"] == "tiktok"
        assert o1["status"] == "approved"
        assert o1["approved_commission"] == 20000
        # 20000 - 10% PIT = 18000 * 0.80 = 14400
        assert o1["cashback_amount"] == 14400

        o2 = ledger.get_order(conn, "TT_REC_02")
        assert o2 is not None
        assert o2["platform"] == "tiktok"
        assert o2["status"] == "rejected"
        assert o2["rejection_reason"] == "Order refunded"


def test_tiktok_provider_official_accesstrade_schema():
    """Verify parsing against exact official AccessTrade v2 responses."""
    provider = TikTokAccessTradeProvider()

    # 1. Official v2 create_link response format (nested in 'data' and dot-formatted amount)
    official_create_link_resp = {
        "status": True,
        "message": "Success",
        "data": {
            "aff_short_url": "https://shorten.accesstrade.vn/WxmudqdK",
            "aff_url": "https://tracking.accesstrade.me/deep_link/...",
            "product_id": "1729836100247522192",
            "product_name": "Tai nghe Bluetooth Pro",
            "product_image": "https://p16.tiktokcdn.com/sample.jpg",
            "product_price": {"amount": "350.000", "currency": "VND"},
            "product_commission": {"amount": "35.000", "currency": "VND", "rate": 1000},
        },
    }

    # Simulate _call_accesstrade_create_link returning official response
    provider._call_accesstrade_create_link = lambda *args, **kwargs: official_create_link_resp

    preview = provider.preview("https://vt.tiktok.com/ZSBKCcJrf/", advertised_rate=0.80)
    assert preview is not None
    assert preview.name == "Tai nghe Bluetooth Pro"
    assert preview.price == 350000
    assert preview.raw_commission == 35000
    assert preview.net_commission == 31500  # 35000 - 10% tax
    assert preview.cashback_amount == 25200  # 31500 * 80%

    # 2. Official v1/order-list response format (using billing, pub_commission, sub_1, status: 0/1/2)
    official_orders_resp = {
        "total": 2,
        "data": [
            {
                "order_id": "AT_ORD_101",
                "sub_1": "C_TEST",
                "sub_2": "R_REQ_101",
                "billing": "450.000",
                "pub_commission": "45.000",
                "status": 1,
                "created_time": "2026-09-22T08:00:00Z",
            },
            {
                "order_id": "AT_ORD_102",
                "sub1": "C_TEST",
                "sub2": "R_REQ_102",
                "order_amount": 150000.0,
                "commission": 15000.0,
                "status": 0,
                "created_time": "2026-09-22T08:30:00Z",
            },
        ],
    }

    parsed = provider.parse_orders(official_orders_resp)
    assert len(parsed) == 2
    assert parsed[0].order_id == "AT_ORD_101"
    assert parsed[0].customer_id == "C_TEST"
    assert parsed[0].request_id == "R_REQ_101"
    assert parsed[0].order_value == 450000
    assert parsed[0].approved_commission == 45000
    assert parsed[0].status == "approved"

    assert parsed[1].order_id == "AT_ORD_102"
    assert parsed[1].order_value == 150000
    assert parsed[1].estimated_commission == 15000
    assert parsed[1].status == "awaiting_approval"


def test_lazada_provider_preview_and_create_link(test_db):
    from cashback.providers.lazada_provider import LazadaAccessTradeProvider

    provider = LazadaAccessTradeProvider()
    test_url = "https://www.lazada.vn/products/tai-nghe-bluetooth-i123456789.html"

    # 1. Preview
    preview = provider.preview(test_url, advertised_rate=0.80)
    assert preview is not None
    assert preview.platform == "lazada"
    assert "Tai Nghe Bluetooth" in preview.name
    assert preview.price >= 0
    assert "Lazada" in preview.price_formatted or "đ" in preview.price_formatted
    assert "hoa hồng" in preview.cashback_formatted or "đ" in preview.cashback_formatted

    # 2. Create link
    with ledger.connect(test_db) as conn:
        res = provider.create_link(
            url=test_url,
            customer_id="C_TEST",
            request_id="R_LAZ_01",
            conn=conn,
            advertised_rate=0.80,
        )

    assert res.platform == "lazada"
    assert res.is_ready is True
    assert res.affiliate_url is not None
    assert "lazada" in res.affiliate_url or "accesstrade" in res.affiliate_url

    with ledger.connect(test_db) as conn:
        row = conn.execute("SELECT * FROM link_requests WHERE request_id = 'R_LAZ_01'").fetchone()
        assert row is not None
        assert row["platform"] == "lazada"
        assert row["affiliate_url"] == res.affiliate_url


def test_lazada_provider_parse_orders():
    from cashback.providers.lazada_provider import LazadaAccessTradeProvider

    provider = LazadaAccessTradeProvider()
    raw_api_response = {
        "status": True,
        "data": [
            {
                "order_id": "LAZ_ORD_001",
                "sub1": "C_TEST",
                "sub2": "R_LAZ_01",
                "order_value": 450000,
                "commission": 45000,
                "order_status": 1,
                "order_time": "2026-09-22 14:00:00",
            },
            {
                "order_id": "LAZ_ORD_002",
                "sub1": "C_TEST",
                "sub2": "R_LAZ_02",
                "order_value": 200000,
                "commission": 20000,
                "order_status": 2,
                "reject_reason": "Cancelled by buyer",
                "order_time": "2026-09-22 14:30:00",
            },
        ],
    }

    orders = provider.parse_orders(raw_api_response)
    assert len(orders) == 2

    o1 = orders[0]
    assert o1.order_id == "LAZ_ORD_001"
    assert o1.platform == "lazada"
    assert o1.customer_id == "C_TEST"
    assert o1.status == "approved"
    assert o1.approved_commission == 45000

    o2 = orders[1]
    assert o2.order_id == "LAZ_ORD_002"
    assert o2.platform == "lazada"
    assert o2.status == "rejected"
    assert o2.rejection_reason == "Cancelled by buyer"


def test_shopeefood_provider_preview_and_create_link(test_db):
    from cashback.providers.shopeefood_provider import ShopeeFoodProvider

    provider = ShopeeFoodProvider()
    test_url = "https://shopeefood.vn/ho-chi-minh/tra-sua-gong-cha"
    test_short_url = "https://shopeefood.vn/u/u1vZZ8Q"

    # 1. Preview store URL
    preview = provider.preview(test_url, advertised_rate=0.80)
    assert preview is not None
    assert preview.platform == "shopeefood"
    assert "Tra Sua Gong Cha" in preview.name
    assert "Ho Chi Minh" in preview.name
    assert preview.price_formatted == "Theo thực đơn quán"

    # 2. Preview short invite/share URL (returns empty string so bot omits generic placeholder line)
    preview_short = provider.preview(test_short_url, advertised_rate=0.80)
    assert preview_short is not None
    assert preview_short.name == ""

    # 3. Create link (queued as pending when browser extension is offline)
    with ledger.connect(test_db) as conn:
        res = provider.create_link(
            url=test_url,
            customer_id="C_TEST",
            request_id="R_FOOD_01",
            conn=conn,
            advertised_rate=0.80,
        )

    assert res.platform == "shopeefood"
    assert res.is_ready is False  # Waiting for browser extension to generate official s.shopee.vn link

    with ledger.connect(test_db) as conn:
        row = conn.execute("SELECT * FROM link_requests WHERE request_id = 'R_FOOD_01'").fetchone()
        assert row is not None
        assert row["platform"] == "shopeefood"
        assert row["status"] == "pending"


