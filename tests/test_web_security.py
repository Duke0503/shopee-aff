"""What a visitor from the internet can and cannot do.

A link made under someone's code pays that someone, so a code is enough to
make one. What the web must never do is invent customers, answer on the
assistant's trusted endpoint, or let anyone hammer the login and link
endpoints.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request

import pytest

from cashback.ledger import repository as ledger
from cashback.web import dashboard

PRODUCT = "https://shopee.vn/product/166586877/10096389022"
MEMBER = "6823332485297437912"
INTERNET = {"CF-Connecting-IP": "203.0.113.7"}


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


def _customers(db):
    with ledger.connect(db) as conn:
        # The house account (guest links) always exists; it is not a person.
        return conn.execute("SELECT COUNT(*) FROM customers WHERE customer_id != ?",
                            (ledger.HOUSE_CUSTOMER_ID,)).fetchone()[0]


def _get(url, headers=None):
    request = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read()) | {"_status": response.status}
    except urllib.error.HTTPError as err:
        return json.loads(err.read()) | {"_status": err.code}


def test_the_campaign_offer_is_for_the_assistant_only(server, db):
    from cashback.ledger import campaigns
    with ledger.connect(db) as conn:
        campaigns.create(conn, "t", "T", "2026-01-01T00:00:00+07:00",
                         "2099-01-01T00:00:00+07:00", 20, 20_000)
    url = f"{server}/api/campaigns/offer?customer_id={MEMBER}&platform=shopee"
    assert _get(url, INTERNET)["_status"] == 403
    local = _get(url)
    assert local["ok"] and local["offer"]["left"] == 20
    assert _get(f"{server}/api/campaigns/offer?customer_id=nobody")["offer"] is None


def test_the_assistants_endpoint_is_closed_to_the_internet(server):
    res = _post(f"{server}/api/shopee/smart-resolve",
                {"url": PRODUCT, "customer_id": MEMBER}, INTERNET)
    assert res["_status"] == 403


def test_a_visitor_with_a_real_code_gets_a_link_request(server, db):
    res = _post(f"{server}/api/shopee/convert",
                {"url": PRODUCT, "customer_id": "dp00001"}, INTERNET)
    assert res["_status"] == 200 and res["ok"]
    with ledger.connect(db) as conn:
        assert conn.execute("SELECT customer_id FROM link_requests"
                            ).fetchone()[0] == MEMBER


def test_the_web_never_invents_a_customer(server, db):
    res = _post(f"{server}/api/shopee/convert",
                {"url": PRODUCT, "customer_id": "9999999999999999999"}, INTERNET)
    assert res["_status"] == 404
    assert res["error"] == "customer_not_found"
    assert _customers(db) == 1


def test_only_the_assistant_introduces_a_new_member(server, db):
    res = _post(f"{server}/api/shopee/convert",
                {"url": PRODUCT, "customer_id": "7000000000000000001"})
    assert res["ok"]
    assert _customers(db) == 2


def test_link_requests_from_one_address_are_bounded(server):
    limit, _ = dashboard._LIMITS["/api/shopee/convert"]
    for _ in range(limit):
        _post(f"{server}/api/shopee/convert",
              {"url": PRODUCT, "customer_id": "dp00001"}, INTERNET)
    res = _post(f"{server}/api/shopee/convert",
                {"url": PRODUCT, "customer_id": "dp00001"}, INTERNET)
    assert res["_status"] == 429


def test_the_assistant_is_never_rate_limited(server):
    limit, _ = dashboard._LIMITS["/api/shopee/convert"]
    for _ in range(limit + 5):
        res = _post(f"{server}/api/shopee/convert",
                    {"url": PRODUCT, "customer_id": MEMBER})
    assert res["_status"] == 200


def test_password_guessing_is_bounded_per_address(server):
    limit, _ = dashboard._LIMITS["/api/auth/login"]
    for i in range(limit):
        _post(f"{server}/api/auth/login",
              {"name": f"DP{i:05d}", "password": "guess"}, INTERNET)
    res = _post(f"{server}/api/auth/login",
                {"name": "DP00001", "password": "guess"}, INTERNET)
    assert res["_status"] == 429


def test_the_window_forgets_old_attempts():
    limiter = dashboard._RateLimiter()
    limit, window = dashboard._LIMITS["/api/auth/login"]
    for _ in range(limit):
        assert limiter.allow("/api/auth/login", "a", now=0.0)
    assert not limiter.allow("/api/auth/login", "a", now=1.0)
    assert limiter.allow("/api/auth/login", "a", now=window + 1.0)
