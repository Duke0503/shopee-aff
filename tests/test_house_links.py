"""Links for web visitors who gave no code: the house account.

The commission from a guest's purchase is ours; the guest is told so. One
link per product serves every guest, so a flood of visitors cannot flood
Shopee. Nothing about the house account may ever look like money owed.
"""

from __future__ import annotations

import itertools
import json
import urllib.error
import urllib.request

import pytest

from cashback.ledger import payouts
from cashback.ledger import repository as ledger
from cashback.messaging import notifications
from cashback.web import dashboard

HOUSE = ledger.HOUSE_CUSTOMER_ID
PRODUCT = "https://shopee.vn/product/166586877/10096389022"
SAME_PRODUCT_OTHER_URL = "https://shopee.vn/Thing-i.166586877.10096389022"
MEMBER = "6823332485297437912"
_ips = (f"203.0.113.{n % 250}" for n in itertools.count(1))


def _internet():
    return {"CF-Connecting-IP": next(_ips)}


@pytest.fixture
def server(db):
    dashboard._limiter = dashboard._RateLimiter()
    with ledger.connect(db) as conn:
        ledger.add_customer(conn, MEMBER, zalo_user_id=MEMBER)
    from cashback.core.config import load
    cfg = load()
    object.__setattr__(cfg, "db_path", db)
    srv = dashboard.serve_in_background(cfg, port=0)
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()
    srv.server_close()


def _post(url, body, headers=None):
    request = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", **(headers or {})},
        method="POST")
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read()) | {"_status": response.status}
    except urllib.error.HTTPError as err:
        return json.loads(err.read()) | {"_status": err.code}


def _requests(db, customer_id=None):
    with ledger.connect(db) as conn:
        sql = "SELECT request_id, customer_id, channel FROM link_requests"
        if customer_id:
            return conn.execute(sql + " WHERE customer_id=?", (customer_id,)).fetchall()
        return conn.execute(sql).fetchall()


class TestTheHouseAccount:
    def test_it_exists_and_has_no_customer_code(self, conn):
        row = ledger.get_customer(conn, HOUSE)
        assert row["role"] == ledger.HOUSE_ROLE
        assert row["customer_code"] is None

    def test_an_approved_guest_order_pays_nobody(self, conn):
        ledger.add_order(conn, "O1", HOUSE, None, order_value=100_000,
                         estimated_commission=10_000)
        ledger.mark_approved(conn, "O1", 10_000, 7_000)
        assert ledger.get_order(conn, "O1")["cashback_amount"] == 0
        assert payouts.collect(conn) == []

    def test_nothing_is_ever_sent_to_it(self, db):
        with ledger.connect(db) as conn:
            ledger.add_order(conn, "O1", HOUSE, None, order_value=1,
                             estimated_commission=1)

        class Bot:
            sent = []

            def send(self, uid, text):
                self.sent.append(uid)

        bot = Bot()
        notifications.notify_order_changes(db, bot, 0.8, "30-70 ngay")
        assert bot.sent == []

    def test_guest_orders_stay_off_the_payout_page(self, db):
        with ledger.connect(db) as conn:
            ledger.add_order(conn, "O1", HOUSE, None, order_value=1,
                             estimated_commission=1_000)
        assert dashboard.snapshot(db)["pipeline"] == []


class TestGuestLinks:
    def test_a_visitor_without_a_code_gets_a_house_link(self, server, db):
        res = _post(f"{server}/api/shopee/convert", {"url": PRODUCT}, _internet())
        assert res["ok"] and res["house"] is True
        [row] = _requests(db)
        assert row["customer_id"] == HOUSE and row["channel"] == "web"

    def test_every_guest_shares_one_link_per_product(self, server, db):
        first = _post(f"{server}/api/shopee/convert", {"url": PRODUCT}, _internet())
        second = _post(f"{server}/api/shopee/convert",
                       {"url": SAME_PRODUCT_OTHER_URL}, _internet())
        assert second["request_id"] == first["request_id"]
        assert len(_requests(db, HOUSE)) == 1

    def test_once_made_the_house_link_is_handed_out_again(self, server, db):
        first = _post(f"{server}/api/shopee/convert", {"url": PRODUCT}, _internet())
        with ledger.connect(db) as conn:
            ledger.attach_affiliate_url(conn, first["request_id"],
                                        "https://s.shopee.vn/House", 1_000)
        again = _post(f"{server}/api/shopee/convert",
                      {"url": SAME_PRODUCT_OTHER_URL}, _internet())
        assert again["ready"] and again["affiliate_url"] == "https://s.shopee.vn/House"
        assert again["house"] is True

    def test_a_wrong_code_is_refused_not_turned_into_a_guest(self, server, db):
        res = _post(f"{server}/api/shopee/convert",
                    {"url": PRODUCT, "customer_id": "DP99999"}, _internet())
        assert res["_status"] == 404
        assert _requests(db) == []

    def test_a_customer_with_a_code_is_not_a_guest(self, server, db):
        res = _post(f"{server}/api/shopee/convert",
                    {"url": PRODUCT, "customer_id": "DP00001"}, _internet())
        assert res["house"] is False
        assert _requests(db)[0]["customer_id"] == MEMBER

    def test_the_assistant_never_falls_back_to_the_house(self, server, db):
        res = _post(f"{server}/api/shopee/convert", {"url": PRODUCT})
        assert res["_status"] == 400
        assert _requests(db) == []


class TestTheWebsShare:
    @staticmethod
    def _url(n):
        return f"https://shopee.vn/product/166586877/{20000000000 + n}"

    def test_one_code_cannot_fill_the_queue(self, server):
        limit = dashboard.WEB_LINKS_PER_CUSTOMER_PER_DAY
        for n in range(limit):
            ok = _post(f"{server}/api/shopee/convert",
                       {"url": self._url(n), "customer_id": "DP00001"}, _internet())
            assert ok["_status"] == 200
        res = _post(f"{server}/api/shopee/convert",
                    {"url": self._url(limit), "customer_id": "DP00001"}, _internet())
        assert res["_status"] == 429 and res["error"] == "web_busy"

    def test_guests_together_are_bounded_per_hour(self, server):
        limit = dashboard.WEB_LINKS_PER_HOUR
        for n in range(limit):
            _post(f"{server}/api/shopee/convert", {"url": self._url(n)}, _internet())
        res = _post(f"{server}/api/shopee/convert",
                    {"url": self._url(limit)}, _internet())
        assert res["_status"] == 429 and res["error"] == "web_busy"

    def test_zalo_is_never_capped(self, server):
        for n in range(dashboard.WEB_LINKS_PER_CUSTOMER_PER_DAY + 3):
            res = _post(f"{server}/api/shopee/convert",
                        {"url": self._url(n), "customer_id": MEMBER,
                         "channel": "zalo_dm"})
        assert res["_status"] == 200

    def test_only_the_assistant_may_claim_to_be_zalo(self, server, db):
        _post(f"{server}/api/shopee/convert",
              {"url": self._url(1), "customer_id": MEMBER, "channel": "zalo_dm"})
        _post(f"{server}/api/shopee/convert",
              {"url": self._url(2), "customer_id": "DP00001", "channel": "zalo_dm"},
              _internet())
        channels = sorted(r["channel"] for r in _requests(db))
        assert channels == ["web", "zalo_dm"]


def test_the_queue_serves_zalo_then_web_then_guests(conn):
    ledger.add_customer(conn, MEMBER, zalo_user_id=MEMBER)
    for rid, who, channel in (("R1", HOUSE, "web"), ("R2", MEMBER, "web"),
                              ("R3", MEMBER, "zalo_dm")):
        ledger.record_link_request(conn, rid, who, f"https://shopee.vn/x/{rid}",
                                   None, None, channel)
    order = [r["request_id"] for r in ledger.pending_link_jobs(conn)]
    assert order == ["R3", "R2", "R1"]
