"""The operator console shows the DP code, not the nineteen-digit UID."""

from __future__ import annotations

import json
import urllib.request

import pytest

from cashback.core import accounts
from cashback.ledger import repository as ledger
from cashback.web import dashboard

MEMBER = "7032060209572177151"


@pytest.fixture
def server(db):
    with ledger.connect(db) as conn:
        ledger.add_customer(conn, MEMBER, zalo_user_id=MEMBER, display_name="Khang")
        ledger.add_order(conn, "260924TQXXU92B", MEMBER, None,
                         order_value=1_315_860, estimated_commission=32_896)
        conn.execute("INSERT INTO customers (customer_id, display_name, role, status, created_at)"
                     " VALUES ('admin', 'Admin', 'admin', 'active', ?)", (ledger.now(),))
        password = accounts.issue_password(conn, "admin")
        token = accounts.login(conn, "admin", password).token
    global COOKIE
    COOKIE = f"{dashboard.SESSION_COOKIE}={token}"
    from cashback.core.config import load
    cfg = load()
    object.__setattr__(cfg, "db_path", db)
    srv = dashboard.serve_in_background(cfg, port=0)
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()
    srv.server_close()


COOKIE = ""


def _get(url):
    request = urllib.request.Request(url, headers={"Cookie": COOKIE})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read())


def _rows(body, *keys):
    for key in keys:
        if isinstance(body.get(key), list):
            return body[key]
    raise AssertionError(f"no list under {keys}: {list(body)}")


def test_the_customer_list_carries_the_code(server):
    rows = _rows(_get(f"{server}/api/admin/users"), "users", "items", "data")
    [row] = [r for r in rows if r["customer_id"] == MEMBER]
    assert row["customer_code"] == "DP00001"


def test_customers_can_be_found_by_code(server):
    rows = _rows(_get(f"{server}/api/admin/users?search=dp00001"), "users", "items", "data")
    assert [r["customer_id"] for r in rows] == [MEMBER]


def test_the_order_list_carries_the_code_and_finds_by_it(server):
    rows = _rows(_get(f"{server}/api/admin/orders?search=DP00001"), "orders", "items", "data")
    assert [(r["order_id"], r["customer_code"]) for r in rows] == [("260924TQXXU92B", "DP00001")]
