"""Who gets paid, how much, and what the QR carries.

The threshold and the bank matching are both places where being roughly
right is worse than refusing: a transfer to a stranger holding the same
account number at another bank cannot be undone.
"""

from __future__ import annotations

import pytest

from cashback.core import banks
from cashback.ledger import payouts
from cashback.ledger import repository as ledger


def _approved(conn, order_id: str, customer_id: str, cashback: int):
    ledger.add_order(conn, order_id, customer_id, None,
                     order_value=100_000, estimated_commission=cashback)
    ledger.mark_approved(conn, order_id, cashback * 2, cashback)


@pytest.fixture
def paying_customer(conn):
    ledger.add_customer(conn, "C0001", display_name="Xuan Phuoc",
                        zalo_user_id="u1", private_chat_id="u1")
    ledger.set_bank_details(conn, "C0001", "VCB", "0123456789", "NGUYEN VAN A")
    return "C0001"


class TestGroupingAndReadiness:
    """One transfer settles one person's whole balance.

    There is no minimum: a balance of 6,131 VND is as payable as one of
    600,000. The only thing that holds a transfer back is a missing
    account number, and that is not something the operator can fix
    alone -- the customer has to send it.
    """

    def test_there_is_no_minimum_left_to_import(self):
        assert not hasattr(payouts, "MIN_PAYOUT_VND")

    def test_a_small_balance_is_ready(self, conn, paying_customer):
        _approved(conn, "O1", paying_customer, 6_131)
        ready, blocked = payouts.split_by_bank_details(payouts.collect(conn))
        assert blocked == []
        assert ready[0].amount == 6_131

    def test_orders_accumulate_per_customer(self, conn, paying_customer):
        for i, amount in enumerate([20_000, 20_000, 15_000]):
            _approved(conn, f"O{i}", paying_customer, amount)
        owed = payouts.collect(conn)
        assert len(owed) == 1                  # one person, not three rows
        assert owed[0].amount == 55_000
        assert len(owed[0].order_ids) == 3

    def test_two_customers_are_never_combined(self, conn, paying_customer):
        ledger.add_customer(conn, "C0002", display_name="Someone Else")
        ledger.set_bank_details(conn, "C0002", "TCB", "9876543210", "TRAN B")
        _approved(conn, "O1", paying_customer, 60_000)
        _approved(conn, "O2", "C0002", 10_000)
        owed = {p.customer_id: p for p in payouts.collect(conn)}
        assert owed["C0001"].amount == 60_000
        assert owed["C0002"].amount == 10_000

    def test_without_bank_details_it_is_never_ready(self, conn):
        """The one remaining blocker, and it is the customer's to clear."""
        ledger.add_customer(conn, "C0009", display_name="No Bank")
        _approved(conn, "O1", "C0009", 90_000)
        ready, blocked = payouts.split_by_bank_details(payouts.collect(conn))
        assert ready == []
        assert blocked[0].has_bank_details is False
        assert blocked[0].amount == 90_000      # still owed, still counted


class TestOnlyApprovedMoneyIsListed:
    """The ledger's first rule, enforced again at the point of payment."""

    def test_an_awaiting_order_is_not_owed(self, conn, paying_customer):
        ledger.add_order(conn, "O1", paying_customer, None,
                         order_value=100_000, estimated_commission=90_000)
        assert payouts.collect(conn) == []

    def test_a_paid_order_drops_off_the_list(self, conn, paying_customer):
        _approved(conn, "O1", paying_customer, 60_000)
        assert payouts.collect(conn)
        ledger.mark_paid(conn, "O1")
        assert payouts.collect(conn) == []

    def test_a_rejected_order_is_not_owed(self, conn, paying_customer):
        ledger.add_order(conn, "O1", paying_customer, None,
                         order_value=100_000, estimated_commission=90_000)
        ledger.mark_rejected(conn, "O1", "returned")
        assert payouts.collect(conn) == []


class TestBankMatching:
    """A wrong BIN sends money to a stranger. Refusing is the safe answer."""

    @pytest.mark.parametrize("written,short_name", [
        ("VCB", "Vietcombank"),
        ("vcb", "Vietcombank"),
        ("Vietcombank", "Vietcombank"),
        ("TCB", "Techcombank"),
        ("mb bank", "MBBank"),
        ("970436", "Vietcombank"),
    ])
    def test_known_spellings_resolve(self, written, short_name):
        found = banks.find(written)
        assert found is not None, f"{written} did not resolve"
        assert found["shortName"] == short_name

    @pytest.mark.parametrize("written", ["", "abc xyz", "ngan hang cua toi"])
    def test_an_unclear_name_resolves_to_nothing(self, written):
        assert banks.find(written) is None


class TestTheQr:
    def test_it_carries_bank_account_amount_and_reference(
            self, conn, paying_customer):
        _approved(conn, "O1", paying_customer, 60_000)
        entry = payouts.collect(conn)[0]
        url = entry.qr_url()
        assert url is not None
        assert "970436" in url            # Vietcombank's BIN
        assert "0123456789" in url        # the account
        assert "amount=60000" in url
        assert "DP00001" in url           # the reference identifies the payout

    def test_no_qr_when_the_bank_cannot_be_matched(self, conn):
        ledger.add_customer(conn, "C0003", display_name="Odd Bank")
        ledger.set_bank_details(conn, "C0003", "ngan hang cua toi",
                                "1111111111", "LE C")
        _approved(conn, "O1", "C0003", 60_000)
        entry = payouts.collect(conn)[0]
        assert entry.bank is None
        assert entry.qr_url() is None

    def test_no_qr_without_bank_details(self, conn):
        ledger.add_customer(conn, "C0004", display_name="No Bank")
        _approved(conn, "O1", "C0004", 60_000)
        assert payouts.collect(conn)[0].qr_url() is None

    def test_the_reference_names_the_customer(self, conn, paying_customer):
        _approved(conn, "O1", paying_customer, 60_000)
        assert payouts.collect(conn)[0].reference.endswith("DP00001")

    def test_the_reference_is_plain_ascii(self, conn, paying_customer):
        """Bank references mangle anything else."""
        _approved(conn, "O1", paying_customer, 60_000)
        payouts.collect(conn)[0].reference.encode("ascii")


class TestOrdering:
    def test_the_largest_debt_is_listed_first(self, conn, paying_customer):
        ledger.add_customer(conn, "C0002", display_name="Bigger")
        ledger.set_bank_details(conn, "C0002", "ACB", "5555555555", "PHAM D")
        _approved(conn, "O1", paying_customer, 60_000)
        _approved(conn, "O2", "C0002", 200_000)
        assert [p.customer_id for p in payouts.collect(conn)] == ["C0002", "C0001"]
