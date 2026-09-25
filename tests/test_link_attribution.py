"""A link belongs to the customer it was made for.

Its sub_id1 is that customer's id, and reconciliation credits every order
on it to them. products_cache used to hand the first asker's link to
everyone who later asked for the same product, so a second customer's
purchase was paid to the first. Product facts may be shared; links never.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request

import pytest

from cashback.ledger import repository as ledger
from cashback.providers.shopee_provider import ShopeeProvider
from cashback.web import dashboard

PRODUCT = "https://shopee.vn/product/166586877/10096389022"
FIRST, SECOND = "1000000000000000001", "1000000000000000002"
FIRST_LINK = "https://s.shopee.vn/FirstOnly"


@pytest.fixture
def seeded(conn, db):
    ledger.add_customer(conn, FIRST, display_name="First", zalo_user_id=FIRST)
    ledger.add_customer(conn, SECOND, display_name="Second", zalo_user_id=SECOND)
    ledger.record_link_request(conn, "R26092500001", FIRST, PRODUCT, None,
                               5_000, "zalo_dm")
    ledger.attach_affiliate_url(conn, "R26092500001", FIRST_LINK, 5_000)
    # The cache still holds the first customer's link, as it does in the
    # live database for products asked about before this was fixed.
    ledger.upsert_product_cache(
        conn, item_id="10096389022", shop_id="166586877", name="Thing", price=100_000,
        price_formatted="100.000", total_commission=5_000,
        commission_formatted="5.000", cashback=3_560,
        cashback_formatted="3.560", affiliate_url=FIRST_LINK,
        canonical_url=PRODUCT)
    conn.commit()
    return db


@pytest.fixture
def server(seeded):
    from cashback.core.config import load
    cfg = load()
    object.__setattr__(cfg, "db_path", seeded)
    srv = dashboard.serve_in_background(cfg, port=0)
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()
    srv.server_close()


def _post(url: str, body: dict) -> dict:
    request = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as err:
        return json.loads(err.read()) | {"_status": err.code}


def _requests_of(db, customer_id):
    with ledger.connect(db) as conn:
        return conn.execute(
            "SELECT request_id, affiliate_url FROM link_requests"
            " WHERE customer_id=?", (customer_id,)).fetchall()


class TestSmartResolve:
    def test_a_second_customer_never_gets_the_first_customers_link(
            self, server, seeded):
        res = _post(f"{server}/api/shopee/smart-resolve",
                    {"url": PRODUCT, "customer_id": SECOND})
        assert res.get("affiliate_url") != FIRST_LINK
        rows = _requests_of(seeded, SECOND)
        assert len(rows) == 1 and rows[0]["affiliate_url"] in (None, "")

    def test_the_owner_gets_their_own_link_back_instantly(self, server, seeded):
        res = _post(f"{server}/api/shopee/smart-resolve",
                    {"url": PRODUCT, "customer_id": FIRST})
        assert res["ready"] is True
        assert res["source"] == "cache_instant"
        assert res["affiliate_url"] == FIRST_LINK
        assert res["request_id"] == "R26092500001"
        assert res["price"] == 100_000
        assert len(_requests_of(seeded, FIRST)) == 1

    def test_no_customer_is_refused_not_filed_under_a_default(self, server,
                                                              seeded):
        res = _post(f"{server}/api/shopee/smart-resolve", {"url": PRODUCT})
        assert res["_status"] == 400
        with ledger.connect(seeded) as conn:
            assert conn.execute(
                "SELECT 1 FROM customers WHERE customer_id='C0001'"
            ).fetchone() is None


class TestConvert:
    def test_a_second_customer_never_gets_the_first_customers_link(
            self, server, seeded):
        res = _post(f"{server}/api/shopee/convert",
                    {"url": PRODUCT, "customer_id": SECOND})
        assert res.get("affiliate_url") != FIRST_LINK
        assert len(_requests_of(seeded, SECOND)) == 1


class TestProvider:
    def test_a_second_customer_never_gets_the_first_customers_link(
            self, conn, seeded):
        res = ShopeeProvider().create_link(
            PRODUCT, SECOND, "R26092500002", conn, 0.8)
        assert res.affiliate_url != FIRST_LINK
        assert res.is_ready is False

    def test_the_owner_reuses_their_own_link(self, conn, seeded):
        res = ShopeeProvider().create_link(
            PRODUCT, FIRST, "R26092500003", conn, 0.8)
        assert res.affiliate_url == FIRST_LINK
