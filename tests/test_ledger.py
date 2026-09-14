"""The three rules the ledger enforces, and the migration that feeds it.

These are not style preferences. Each one exists because breaking it costs
real money or strands a real customer.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from cashback.core.identifiers import assert_valid_sub_id, new_request_id, next_customer_id
from cashback.ledger import repository as ledger


def _order(conn: sqlite3.Connection, order_id: str = "O0001",
           customer_id: str = "C0001", estimate: int = 9_263) -> str:
    request_id = new_request_id()
    ledger.record_link_request(conn, request_id, customer_id,
                               "https://s.shopee.vn/x", None, estimate, "zalo")
    ledger.add_order(conn, order_id, customer_id, request_id,
                     order_value=97_500, estimated_commission=estimate)
    return order_id


class TestRuleOnePayFromApprovedOnly:
    """Cashback comes from what Shopee approved, never from the estimate.

    The estimate is shown at link time from a price that may change, a rate
    that may change, and sometimes a cached third party. Paying from it
    means paying a number nobody ever received.
    """

    def test_approved_amount_replaces_the_estimate(self, conn, customer):
        _order(conn, estimate=9_263)
        # Shopee approved less than the estimate suggested.
        ledger.mark_approved(conn, "O0001", approved_commission=5_000,
                             cashback_amount=3_500)
        row = ledger.get_order(conn, "O0001")
        assert row["approved_commission"] == 5_000
        assert row["cashback_amount"] == 3_500
        assert row["estimated_commission"] == 9_263   # kept, but not paid from

    def test_only_approved_orders_reach_the_payout_list(self, conn, customer):
        _order(conn, "O0001")
        _order(conn, "O0002")
        ledger.mark_approved(conn, "O0002", 5_000, 3_500)
        awaiting = [r["order_id"] for r in ledger.orders_awaiting_payout(conn)]
        assert awaiting == ["O0002"]


class TestRuleTwoNeverPayTwice:
    """An order carrying `paid_at` is never reprocessed.

    Reconciliation runs over overlapping periods by design, so the same row
    arrives again and again. Without the guard the same order pays out on
    every pass.
    """

    def test_marking_paid_twice_is_refused(self, conn, customer):
        _order(conn)
        ledger.mark_approved(conn, "O0001", 5_000, 3_500)
        assert ledger.mark_paid(conn, "O0001") is True
        assert ledger.mark_paid(conn, "O0001") is False

    def test_a_paid_order_cannot_be_re_approved(self, conn, customer):
        _order(conn)
        ledger.mark_approved(conn, "O0001", 5_000, 3_500)
        ledger.mark_paid(conn, "O0001")
        # A later report tries to approve it again with a bigger number.
        ledger.mark_approved(conn, "O0001", 99_000, 70_000)
        row = ledger.get_order(conn, "O0001")
        assert row["cashback_amount"] == 3_500     # unchanged
        assert row["status"] == ledger.PAID

    def test_unapproved_order_cannot_be_paid(self, conn, customer):
        _order(conn)
        assert ledger.mark_paid(conn, "O0001") is False


class TestRuleThreeNeverStrandMoney:
    """A customer owed money cannot be erased by accident."""

    def test_forget_is_refused_while_money_is_owed(self, conn, customer):
        _order(conn)
        ledger.mark_approved(conn, "O0001", 5_000, 3_500)
        outcome = ledger.forget_customer(conn, customer)
        assert outcome["deleted"] is False
        # The refusal says how much, so the operator can settle it.
        assert outcome["owed_orders"] == 1
        assert outcome["owed_amount"] == 3_500
        assert ledger.get_customer(conn, customer) is not None

    def test_force_overrides_it_deliberately(self, conn, customer):
        _order(conn)
        ledger.mark_approved(conn, "O0001", 5_000, 3_500)
        outcome = ledger.forget_customer(conn, customer, force=True)
        assert outcome["deleted"] is True
        assert ledger.get_customer(conn, customer) is None

    def test_a_settled_customer_can_be_forgotten(self, conn, customer):
        _order(conn)
        ledger.mark_approved(conn, "O0001", 5_000, 3_500)
        ledger.mark_paid(conn, "O0001")
        outcome = ledger.forget_customer(conn, customer)
        assert outcome["deleted"] is True

    def test_forgetting_an_unknown_customer_says_so(self, conn):
        assert ledger.forget_customer(conn, "C9999") == {"found": False}


class TestStateHistoryIsAppendOnly:
    """Every transition is kept, so a dispute can be answered with facts."""

    def test_each_transition_leaves_a_row(self, conn, customer):
        _order(conn)
        ledger.mark_approved(conn, "O0001", 5_000, 3_500)
        ledger.mark_paid(conn, "O0001")
        rows = conn.execute(
            "SELECT to_status FROM state_history WHERE order_id='O0001'"
            " ORDER BY id").fetchall()
        statuses = [r["to_status"] for r in rows]
        assert ledger.APPROVED in statuses
        assert ledger.PAID in statuses
        assert statuses.index(ledger.APPROVED) < statuses.index(ledger.PAID)


class TestMigrations:
    """Columns added after release are applied on open, not by hand.

    Skipping this once left the running bot querying a column that did not
    exist; every delivery failed silently for four passes.
    """

    def test_initialise_is_idempotent(self, db: Path):
        ledger.initialise(db)
        ledger.initialise(db)
        with ledger.connect(db) as conn:
            columns = {r[1] for r in conn.execute("PRAGMA table_info(orders)")}
        assert "notified_status" in columns

    def test_later_columns_are_present_on_a_fresh_database(self, conn):
        requests = {r[1] for r in conn.execute("PRAGMA table_info(link_requests)")}
        assert {"notified_at", "estimate_source", "estimate_detail",
                "attempts"} <= requests


class TestSubIdSafety:
    """A sub_id with a dash breaks attribution two months later, silently."""

    def test_generated_ids_are_alphanumeric(self, conn):
        assert_valid_sub_id(new_request_id())
        ledger.add_customer(conn, "C0001")
        assert_valid_sub_id(next_customer_id(conn))

    @pytest.mark.parametrize("bad", ["R260910-0187", "C_0001", "R 0001", ""])
    def test_separators_are_refused(self, bad):
        with pytest.raises(ValueError):
            assert_valid_sub_id(bad)


class TestNeverStoreSomeoneElsesLink:
    """An affiliate link points at one product.

    A stale read from the browser once handed the previous customer's link
    back as this customer's answer. The message would have quoted the right
    price for the wrong product, and the purchase would have earned
    commission on something the customer never asked for.
    """

    def test_a_link_already_used_for_another_product_is_refused(self, conn, customer):
        ledger.record_link_request(conn, "R00000000001", customer,
                                   "https://s.shopee.vn/aaa", None, None, "zalo")
        ledger.record_link_request(conn, "R00000000002", customer,
                                   "https://s.shopee.vn/bbb", None, None, "zalo")
        assert ledger.attach_affiliate_url(
            conn, "R00000000001", "https://s.shopee.vn/SAME") is True
        assert ledger.attach_affiliate_url(
            conn, "R00000000002", "https://s.shopee.vn/SAME") is False
        second = ledger.get_link_request(conn, "R00000000002") \
            if hasattr(ledger, "get_link_request") else conn.execute(
                "SELECT affiliate_url FROM link_requests WHERE request_id=?",
                ("R00000000002",)).fetchone()
        assert second["affiliate_url"] is None

    def test_the_same_product_twice_may_share_a_link(self, conn, customer):
        """Two people asking for one product is normal, not a clash."""
        for request_id in ("R00000000003", "R00000000004"):
            ledger.record_link_request(conn, request_id, customer,
                                       "https://s.shopee.vn/same-product",
                                       None, None, "zalo")
        assert ledger.attach_affiliate_url(
            conn, "R00000000003", "https://s.shopee.vn/X") is True
        assert ledger.attach_affiliate_url(
            conn, "R00000000004", "https://s.shopee.vn/X") is True
