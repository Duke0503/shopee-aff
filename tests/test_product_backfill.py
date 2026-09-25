"""Pictures for links saved before pictures were stored.

A short link hides the item id, so the backfill resolves it once, stores
the id with the estimate, and never touches the money figures.
"""

from __future__ import annotations

import json
from types import SimpleNamespace

from cashback.ledger import repository as ledger
from cashback.shopee import product_backfill
from cashback.web import dashboard

SHORT = "https://s.shopee.vn/6VO6fl6Hq9"
LONG = "https://shopee.vn/product/166586877/10096389022"


def _request(conn, request_id="R26092100001", source=SHORT, detail=None):
    ledger.add_customer(conn, "111", zalo_user_id="111")
    ledger.record_link_request(conn, request_id, "111", source, None, 5_000, "zalo")
    ledger.attach_affiliate_url(conn, request_id, "https://s.shopee.vn/aff", 5_000)
    conn.execute("UPDATE link_requests SET estimate_detail=? WHERE request_id=?",
                 (json.dumps(detail or {"name": "Chuot", "commission": 5000}),
                  request_id))


def _detail(conn, request_id="R26092100001"):
    return json.loads(conn.execute(
        "SELECT estimate_detail FROM link_requests WHERE request_id=?",
        (request_id,)).fetchone()[0])


def _estimate(image="https://cf.shopee.vn/pic.jpg"):
    return SimpleNamespace(name="Chuot Razer", price=1_315_860, image_url=image)


class TestFilling:
    def test_a_short_link_is_resolved_and_the_picture_stored(self, conn):
        _request(conn)
        [r] = product_backfill.run(conn, apply=True, only_ordered=False, pause_seconds=0,
                                   resolve=lambda url: LONG,
                                   look_up=lambda url, third_party: _estimate())
        assert r.source == "lookup"
        detail = _detail(conn)
        assert detail["image_url"] == "https://cf.shopee.vn/pic.jpg"
        assert detail["item_id"] == "10096389022"

    def test_the_money_already_quoted_is_left_alone(self, conn):
        _request(conn)
        product_backfill.run(conn, apply=True, only_ordered=False, pause_seconds=0,
                             resolve=lambda url: LONG,
                             look_up=lambda url, third_party: _estimate())
        detail = _detail(conn)
        assert detail["commission"] == 5000
        assert detail["name"] == "Chuot"
        row = conn.execute("SELECT estimated_commission FROM link_requests").fetchone()
        assert row[0] == 5_000

    def test_a_cached_picture_needs_no_lookup(self, conn):
        _request(conn)
        ledger.upsert_product_cache(conn, item_id="10096389022", name="Chuot",
                                    price=1, image_url="https://cf/c.jpg")

        def must_not_look_up(url, third_party):
            raise AssertionError("looked up a product already cached")

        [r] = product_backfill.run(conn, apply=True, only_ordered=False, pause_seconds=0,
                                   resolve=lambda url: LONG, look_up=must_not_look_up)
        assert r.source == "cache"

    def test_no_link_ever_enters_the_shared_cache(self, conn):
        _request(conn)
        product_backfill.run(conn, apply=True, only_ordered=False, pause_seconds=0,
                             resolve=lambda url: LONG,
                             look_up=lambda url, third_party: _estimate())
        cached = ledger.get_product_cache(conn, "10096389022")
        assert cached["image_url"] and not cached["affiliate_url"]

    def test_a_capped_product_keeps_its_cap_flag(self, conn):
        _request(conn)
        ledger.upsert_product_cache(conn, item_id="10096389022", name="Xe",
                                    price=84_600_000, is_capped=True)
        product_backfill.run(conn, apply=True, only_ordered=False, pause_seconds=0,
                             resolve=lambda url: LONG,
                             look_up=lambda url, third_party: _estimate())
        assert ledger.get_product_cache(conn, "10096389022")["is_capped"] == 1

    def test_a_dry_run_writes_nothing(self, conn):
        _request(conn)
        product_backfill.run(conn, apply=False, only_ordered=False, pause_seconds=0,
                             resolve=lambda url: LONG,
                             look_up=lambda url, third_party: _estimate())
        assert "image_url" not in _detail(conn)
        assert ledger.get_product_cache(conn, "10096389022") is None

    def test_by_default_only_links_with_an_order_are_touched(self, conn):
        _request(conn)
        assert product_backfill.missing_pictures(conn) == []
        ledger.add_order(conn, "O1", "111", "R26092100001",
                         order_value=1, estimated_commission=1)
        assert len(product_backfill.missing_pictures(conn)) == 1


def test_the_console_finds_the_picture_by_the_stored_item_id(conn):
    ledger.upsert_product_cache(conn, item_id="10096389022", name="Chuot",
                                price=1, image_url="https://cf/c.jpg")
    name, image = dashboard._resolve_product_info(
        conn, json.dumps({"item_id": "10096389022"}),
        "https://s.shopee.vn/aff", SHORT)
    assert image == "https://cf/c.jpg"
