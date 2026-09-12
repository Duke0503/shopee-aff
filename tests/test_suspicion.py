"""The patterns flagged before money leaves the account.

None of these prove wrongdoing, and the tests say so: the point is that a
finding names the evidence that produced it, so the operator decides.
"""

from __future__ import annotations

import sqlite3

import pytest

from cashback.core import audit
from cashback.ledger import repository as ledger, suspicion


def _add(conn: sqlite3.Connection, customer_id: str, account: str | None = None):
    ledger.add_customer(conn, customer_id, display_name=customer_id,
                        zalo_user_id=customer_id, private_chat_id=customer_id)
    if account:
        ledger.set_bank_details(conn, customer_id, "VCB", account, "NGUYEN VAN A")


def _order(conn: sqlite3.Connection, order_id: str, customer_id: str,
           status: str = ledger.AWAITING_APPROVAL):
    ledger.add_order(conn, order_id, customer_id, None,
                     order_value=100_000, estimated_commission=5_000)
    if status == ledger.REJECTED:
        ledger.mark_rejected(conn, order_id, "returned")
    elif status == ledger.APPROVED:
        ledger.mark_approved(conn, order_id, 5_000, 3_500)


class TestFingerprint:
    """Account numbers are compared, never stored in the trail.

    Log files get copied into chat and attached to email. The fingerprint
    is enough to notice two customers sharing one account and useless for
    paying anyone.
    """

    def test_same_account_gives_the_same_mark(self):
        assert audit.fingerprint("0123456789") == audit.fingerprint("0123456789")

    def test_different_accounts_differ(self):
        assert audit.fingerprint("0123456789") != audit.fingerprint("0123456780")

    def test_the_number_cannot_be_read_back_out(self):
        mark = audit.fingerprint("0123456789")
        assert "0123456789" not in mark
        assert len(mark) == 12

    def test_empty_input_is_empty_output(self):
        assert audit.fingerprint("") == ""


class TestSharedBankAccount:
    """The highest-severity pattern: one payout account, several customers."""

    def test_two_customers_one_account_flags_both(self, conn):
        _add(conn, "C0001", "0123456789")
        _add(conn, "C0002", "0123456789")
        findings = suspicion.shared_bank_accounts(conn)
        assert {f.customer_id for f in findings} == {"C0001", "C0002"}
        assert all(f.severity == suspicion.HIGH for f in findings)

    def test_the_finding_names_the_other_customer(self, conn):
        _add(conn, "C0001", "0123456789")
        _add(conn, "C0002", "0123456789")
        finding = next(f for f in suspicion.shared_bank_accounts(conn)
                       if f.customer_id == "C0001")
        assert any("C0002" in line for line in finding.evidence)

    def test_distinct_accounts_are_not_flagged(self, conn):
        _add(conn, "C0001", "0123456789")
        _add(conn, "C0002", "9876543210")
        assert suspicion.shared_bank_accounts(conn) == []

    def test_customers_without_an_account_are_not_grouped_together(self, conn):
        _add(conn, "C0001")
        _add(conn, "C0002")
        assert suspicion.shared_bank_accounts(conn) == []


class TestRejectionRate:
    def test_mostly_rejected_is_flagged(self, conn):
        _add(conn, "C0001")
        for i in range(4):
            _order(conn, f"O000{i}", "C0001", ledger.REJECTED)
        findings = suspicion.mostly_rejected(conn)
        assert len(findings) == 1
        assert "4 of 4" in findings[0].summary

    def test_too_few_orders_to_judge(self, conn):
        _add(conn, "C0001")
        _order(conn, "O0001", "C0001", ledger.REJECTED)
        assert suspicion.mostly_rejected(conn) == []

    def test_a_good_customer_is_left_alone(self, conn):
        _add(conn, "C0001")
        for i in range(4):
            _order(conn, f"O000{i}", "C0001", ledger.APPROVED)
        assert suspicion.mostly_rejected(conn) == []


class TestNeverBuys:
    def test_many_links_no_orders(self, conn):
        _add(conn, "C0001")
        for i in range(suspicion.MIN_REQUESTS_TO_JUDGE):
            ledger.record_link_request(conn, f"R{i:011d}", "C0001",
                                       "https://s.shopee.vn/x", None, None, "zalo")
        findings = suspicion.never_buys(conn)
        assert len(findings) == 1
        assert findings[0].severity == suspicion.LOW      # browsing is normal

    def test_a_few_links_is_just_shopping(self, conn):
        _add(conn, "C0001")
        ledger.record_link_request(conn, "R00000000001", "C0001",
                                   "https://s.shopee.vn/x", None, None, "zalo")
        assert suspicion.never_buys(conn) == []


class TestPatternsReadFromTheTrail:
    def test_frequent_bank_changes(self):
        events = [{"event": audit.BANK_CHANGED, "customer_id": "C0001",
                   "account": f"mark{i}"} for i in range(3)]
        findings = suspicion.frequent_bank_changes(events)
        assert len(findings) == 1
        assert "3 times" in findings[0].summary

    def test_two_changes_is_not_a_pattern(self):
        events = [{"event": audit.BANK_CHANGED, "customer_id": "C0001",
                   "account": "m"} for _ in range(2)]
        assert suspicion.frequent_bank_changes(events) == []

    def test_sudden_volume_in_one_day(self):
        events = [{"event": audit.LINK_REQUESTED, "customer_id": "C0001",
                   "at": "2026-09-11T10:00:00+07:00"}
                  for _ in range(suspicion.SUDDEN_VOLUME_PER_DAY)]
        findings = suspicion.sudden_volume(events)
        assert len(findings) == 1
        assert "2026-09-11" in findings[0].summary

    def test_the_same_volume_spread_over_days_is_fine(self):
        events = [{"event": audit.LINK_REQUESTED, "customer_id": "C0001",
                   "at": f"2026-09-{day:02d}T10:00:00+07:00"}
                  for day in range(1, 21)]
        assert suspicion.sudden_volume(events) == []


class TestScanOrdering:
    def test_most_serious_first(self, conn):
        _add(conn, "C0001", "0123456789")
        _add(conn, "C0002", "0123456789")       # HIGH
        _add(conn, "C0003")
        for i in range(suspicion.MIN_REQUESTS_TO_JUDGE):
            ledger.record_link_request(conn, f"R{i:011d}", "C0003",
                                       "https://s.shopee.vn/x", None, None, "zalo")
        findings = suspicion.scan(conn, months=1)
        assert findings[0].severity == suspicion.HIGH
        assert findings[-1].severity == suspicion.LOW

    def test_a_clean_ledger_flags_nothing(self, conn):
        _add(conn, "C0001", "0123456789")
        assert suspicion.scan(conn, months=1) == []

    def test_every_finding_carries_its_reasoning(self, conn):
        _add(conn, "C0001", "0123456789")
        _add(conn, "C0002", "0123456789")
        for finding in suspicion.scan(conn, months=1):
            assert finding.summary
            assert finding.evidence
