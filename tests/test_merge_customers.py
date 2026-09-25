"""One person, two rows: folding them back together.

The bot moved Zalo accounts and saw every member again under a new id.
Merging must keep every order, keep the old id working wherever it still
arrives from, and make a third row for the same person impossible.
"""

from __future__ import annotations

import sqlite3

import pytest

from cashback.core import accounts
from cashback.core.policy import TaxPolicy
from cashback.ledger import merge
from cashback.ledger import repository as ledger

OLD, NEW = "7426531546024632924", "7032060209572177151"
OLD_LINK = "https://s.shopee.vn/OldAccountLink"


@pytest.fixture
def split(tmp_path):
    """The live shape: history on both rows, the old one created first."""
    path = tmp_path / "split.db"
    ledger.initialise(path, assign_codes=False)
    with ledger.connect(path) as conn:
        conn.execute(
            "INSERT INTO customers (customer_id, zalo_user_id, display_name,"
            " created_at) VALUES (?, ?, 'Nguyen Phuc Khang', '2026-09-21 14:05:48')",
            (OLD, OLD))
        conn.execute(
            "INSERT INTO customers (customer_id, zalo_user_id, display_name,"
            " created_at) VALUES (?, ?, 'Nguyen Phuc Khang', '2026-09-24 12:19:14')",
            (NEW, NEW))
        ledger.set_bank_details(conn, OLD, "VCB", "0123456789", "NGUYEN PHUC KHANG")
        ledger.record_link_request(conn, "R26092100001", OLD,
                                   "https://shopee.vn/product/166586877/10096389022",
                                   None, 5_000, "zalo")
        ledger.attach_affiliate_url(conn, "R26092100001", OLD_LINK, 5_000)
        ledger.add_order(conn, "260921AAA", OLD, "R26092100001",
                         order_value=100_000, estimated_commission=5_000)
        ledger.record_link_request(conn, "R26092400001", NEW,
                                   "https://shopee.vn/product/111111/2222222",
                                   None, 3_000, "zalo_dm")
        accounts.issue_password(conn, OLD)
    return path


def _merge_all(path):
    with ledger.connect(path) as conn:
        for pair in merge.find_pairs(conn):
            merge.merge(conn, pair)


class TestPairing:
    def test_the_older_row_is_the_one_folded_in(self, split):
        with ledger.connect(split) as conn:
            [pair] = merge.find_pairs(conn)
        assert (pair.old["customer_id"], pair.new["customer_id"]) == (OLD, NEW)

    def test_two_different_bank_accounts_are_a_human_decision(self, split):
        with ledger.connect(split) as conn:
            ledger.set_bank_details(conn, NEW, "TCB", "9999999999", "SOMEONE ELSE")
            [pair] = merge.find_pairs(conn)
            assert pair.conflict
            with pytest.raises(ValueError):
                merge.merge(conn, pair)


class TestAfterMerging:
    @pytest.fixture
    def merged(self, split):
        _merge_all(split)
        return split

    def test_one_row_remains_holding_everything(self, merged):
        with ledger.connect(merged) as conn:
            assert ledger.get_customer(conn, OLD) is None
            owners = {r[0] for r in conn.execute(
                "SELECT customer_id FROM link_requests UNION"
                " SELECT customer_id FROM orders")}
            assert owners == {NEW}
            survivor = ledger.get_customer(conn, NEW)
            assert survivor["bank_account"] == "0123456789"
            assert survivor["created_at"] == "2026-09-21 14:05:48"

    def test_the_old_id_still_signs_in(self, split):
        with ledger.connect(split) as conn:
            password = accounts.issue_password(conn, OLD)
        _merge_all(split)
        with ledger.connect(split) as conn:
            result = accounts.login(conn, OLD, password)
            assert result.ok and result.customer_id == NEW

    def test_an_order_on_an_old_link_is_credited_to_the_survivor(self, merged):
        from cashback.shopee import reconciliation, report_reader

        row = report_reader._row_to_report_row({
            "utm_content": f"{OLD}-R26092100001---",
            "estimated_total_commission": 500_000_000,
            "orders": [{"order_sn": "260925BBB", "order_status": "PAID",
                        "items": [{"actual_amount": 10_000_000_000,
                                   "display_item_status": "Pending"}]}],
        })
        with ledger.connect(merged) as conn:
            outcome = reconciliation.run(
                conn, [row], cashback_rate=0.80,
                tax_policy=TaxPolicy.USER_ABSORBS,
                period_is_withheld=False, source="test")
            assert outcome.needs_review == 0
            assert ledger.get_order(conn, "260925BBB")["customer_id"] == NEW

    def test_the_old_id_can_never_become_a_customer_again(self, merged):
        with ledger.connect(merged) as conn:
            with pytest.raises(sqlite3.IntegrityError):
                ledger.add_customer(conn, OLD, zalo_user_id=OLD)

    def test_codes_issued_after_merging_leave_no_gap(self, merged):
        ledger.initialise(merged)
        with ledger.connect(merged) as conn:
            codes = [r[0] for r in conn.execute(
                "SELECT customer_code FROM customers WHERE customer_id != ?",
                (ledger.HOUSE_CUSTOMER_ID,))]
            assert codes == ["DP00001"]

    def test_a_retired_code_still_signs_in(self, tmp_path):
        """Codes can be issued before a merge runs (the web shows them).
        The code that is retired must keep meaning the same person."""
        path = tmp_path / "coded.db"
        ledger.initialise(path)
        with ledger.connect(path) as conn:
            for uid, created in ((OLD, "2026-09-21 14:05:48"), (NEW, "2026-09-24 12:19:14")):
                conn.execute(
                    "INSERT INTO customers (customer_id, zalo_user_id, display_name,"
                    " created_at) VALUES (?, ?, 'Same Person', ?)", (uid, uid, created))
            codes = dict(conn.execute("SELECT customer_id, customer_code FROM customers"
                                      " WHERE customer_id IN (?, ?)", (OLD, NEW)).fetchall())
            [pair] = merge.find_pairs(conn)
            merge.merge(conn, pair)
            assert ledger.get_customer(conn, NEW)["customer_code"] == codes[OLD]
            assert ledger.find_customer_id(conn, codes[NEW]) == NEW
            assert ledger.find_customer_id(conn, codes[NEW].lower()) == NEW

    def test_merging_twice_changes_nothing(self, merged):
        with ledger.connect(merged) as conn:
            assert merge.find_pairs(conn) == []


class TestTwoRowsCannotShareAZaloId:
    def test_a_second_row_with_the_same_zalo_id_is_refused(self, conn):
        ledger.add_customer(conn, "111", zalo_user_id="999")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO customers (customer_id, zalo_user_id,"
                         " created_at) VALUES ('222', '999', 'x')")


class TestDeletingNonCustomers:
    def test_a_row_without_history_is_deleted(self, conn):
        ledger.add_customer(conn, "2483222542240728863", display_name="Bot")
        assert merge.delete_unused(conn, "2483222542240728863") == "deleted"

    def test_a_row_with_orders_is_refused(self, conn):
        ledger.add_customer(conn, "111", display_name="Real person")
        ledger.add_order(conn, "O1", "111", None, order_value=1, estimated_commission=1)
        assert merge.delete_unused(conn, "111").startswith("refused")
        assert ledger.get_customer(conn, "111") is not None
