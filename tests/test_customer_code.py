"""DP codes: the short name a customer signs in with.

customer_id stays the Zalo UID because it is inside the sub_id of every
link already issued. The code is only how people refer to themselves.
"""

from __future__ import annotations

import json
import sqlite3
import urllib.error
import urllib.request

import pytest

from cashback.core import accounts
from cashback.ledger import payouts
from cashback.ledger import repository as ledger
from cashback.web import dashboard


def _code(conn, customer_id):
    return conn.execute("SELECT customer_code FROM customers WHERE customer_id=?",
                        (customer_id,)).fetchone()[0]


def _legacy_db(path):
    """A ledger from before codes existed, created_at in both formats."""
    ledger.initialise(path)
    raw = sqlite3.connect(path)
    raw.execute("DROP TRIGGER trg_customer_code")
    raw.execute("DROP INDEX idx_customers_code")
    raw.execute("DROP TABLE customer_code_counter")
    raw.execute("UPDATE customers SET customer_code=NULL")
    rows = [
        # SQLite datetime('now'): UTC, no offset. 01:00 UTC = 08:00 +07.
        ("300", "2026-09-20 01:00:00", "user"),
        # ISO with offset: 07:30 +07 = 00:30 UTC, so this one is older.
        ("100", "2026-09-20T07:30:00+07:00", "user"),
        ("admin", "2026-09-01T00:00:00+07:00", "admin"),
        ("200", "2026-09-21T09:00:00+07:00", "user"),
    ]
    raw.executemany(
        "INSERT INTO customers (customer_id, zalo_user_id, created_at, role)"
        " VALUES (?, ?, ?, ?)", [(i, i, t, r) for i, t, r in rows])
    raw.commit()
    raw.close()


class TestAssignment:
    def test_existing_customers_are_numbered_oldest_first(self, tmp_path):
        path = tmp_path / "legacy.db"
        _legacy_db(path)
        ledger.initialise(path)
        with ledger.connect(path) as conn:
            assert _code(conn, "100") == "DP00001"
            assert _code(conn, "300") == "DP00002"
            assert _code(conn, "200") == "DP00003"

    def test_staff_accounts_get_no_code(self, tmp_path):
        path = tmp_path / "legacy.db"
        _legacy_db(path)
        ledger.initialise(path)
        with ledger.connect(path) as conn:
            assert _code(conn, "admin") is None

    def test_a_second_migration_changes_nothing(self, tmp_path):
        path = tmp_path / "legacy.db"
        _legacy_db(path)
        ledger.initialise(path)
        ledger.initialise(path)
        with ledger.connect(path) as conn:
            assert _code(conn, "200") == "DP00003"

    def test_every_insert_path_gets_the_next_code(self, conn):
        ledger.add_customer(conn, "111", zalo_user_id="111")
        conn.execute("INSERT INTO customers (customer_id, zalo_user_id, created_at)"
                     " VALUES ('222', '222', datetime('now'))")
        assert _code(conn, "111") == "DP00001"
        assert _code(conn, "222") == "DP00002"

    def test_a_deleted_customers_number_is_never_reissued(self, conn):
        """Not even when the deleted one held the highest number."""
        for uid in ("111", "222", "333"):
            ledger.add_customer(conn, uid, zalo_user_id=uid)
        conn.execute("DELETE FROM customers WHERE customer_id='333'")
        ledger.add_customer(conn, "444", zalo_user_id="444")
        assert _code(conn, "444") == "DP00004"

    def test_the_counter_survives_a_restart(self, db):
        with ledger.connect(db) as conn:
            ledger.add_customer(conn, "111", zalo_user_id="111")
            conn.execute("DELETE FROM customers WHERE customer_id='111'")
        ledger.initialise(db)
        with ledger.connect(db) as conn:
            ledger.add_customer(conn, "222", zalo_user_id="222")
            assert _code(conn, "222") == "DP00002"


class TestLogin:
    @pytest.fixture
    def member(self, conn):
        ledger.add_customer(conn, "6823332485297437912",
                            zalo_user_id="6823332485297437912")
        password = accounts.issue_password(conn, "6823332485297437912")
        conn.commit()
        return password

    @pytest.mark.parametrize("typed", ["DP00001", "dp00001", " DP 00001 "])
    def test_the_code_signs_in_however_it_is_typed(self, conn, member, typed):
        result = accounts.login(conn, typed, member)
        assert result.ok and result.customer_id == "6823332485297437912"

    def test_the_long_zalo_id_still_signs_in(self, conn, member):
        assert accounts.login(conn, "6823332485297437912", member).ok


@pytest.fixture
def server(db):
    with ledger.connect(db) as conn:
        ledger.add_customer(conn, "6823332485297437912",
                            zalo_user_id="6823332485297437912")
    from cashback.core.config import load
    cfg = load()
    object.__setattr__(cfg, "db_path", db)
    srv = dashboard.serve_in_background(cfg, port=0)
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()
    srv.server_close()


def _post(url, body):
    request = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as err:
        return json.loads(err.read()) | {"_status": err.code}


PRODUCT = "https://shopee.vn/product/166586877/10096389022"


class TestCodesOverHTTP:
    def test_a_link_asked_for_by_code_is_filed_under_the_real_customer(
            self, server, db):
        _post(f"{server}/api/shopee/convert",
              {"url": PRODUCT, "customer_id": "dp00001"})
        with ledger.connect(db) as conn:
            owners = [r[0] for r in conn.execute(
                "SELECT customer_id FROM link_requests").fetchall()]
            assert owners == ["6823332485297437912"]
            assert conn.execute("SELECT COUNT(*) FROM customers WHERE customer_id != ?", (ledger.HOUSE_CUSTOMER_ID,)).fetchone()[0] == 1

    def test_an_unknown_code_is_refused_not_turned_into_a_customer(
            self, server, db):
        res = _post(f"{server}/api/shopee/smart-resolve",
                    {"url": PRODUCT, "customer_id": "DP99999"})
        assert res["_status"] == 404
        with ledger.connect(db) as conn:
            assert conn.execute("SELECT COUNT(*) FROM customers WHERE customer_id != ?", (ledger.HOUSE_CUSTOMER_ID,)).fetchone()[0] == 1

    def test_the_bot_is_told_the_code(self, server):
        res = _post(f"{server}/api/bot/customer-auth",
                    {"uid": "6823332485297437912", "action": "get_id"})
        assert res["customer_code"] == "DP00001"

    def test_a_brand_new_member_gets_a_code_from_the_bot(self, server):
        res = _post(f"{server}/api/bot/customer-auth",
                    {"uid": "7000000000000000001", "action": "get_id"})
        assert res["customer_code"] == "DP00002"


def test_the_transfer_reference_carries_the_code(conn):
    ledger.add_customer(conn, "6823332485297437912",
                        zalo_user_id="6823332485297437912")
    ledger.add_order(conn, "O1", "6823332485297437912", None,
                     order_value=100_000, estimated_commission=10_000)
    ledger.mark_approved(conn, "O1", 10_000, 8_000)
    [payable] = payouts.collect(conn)
    assert payable.reference == "Hoan tien Shopee DP00001"
