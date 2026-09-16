"""Sending finished links and order news back to the customer.

These exercise the two loops `serve` runs on a timer. Nothing here was
covered before, and that gap cost a customer their link: a rewritten
import inside `deliver_ready_links` raised ImportError on every pass, the
error was caught and logged, and the bot went on cheerfully answering
"dang tao link cho ban" forever.

Function-local imports only fail when the line runs. Importing the module
proves nothing. These tests run the line.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from cashback.ledger import payouts, repository as ledger
from cashback.messaging import conversation as convo

# Two amounts either side of the payout threshold, so a test says which
# side it is testing rather than hiding it in a literal.
BELOW = 6_484
PAYABLE = payouts.MIN_PAYOUT_VND + 12_000


def _vnd(amount: int) -> str:
    """Money as the bot writes it, for asserting on message text."""
    return convo._vnd(amount)


class FakeBot:
    """Records what would have been sent."""

    def __init__(self, fail: bool = False):
        self.sent: list[tuple[str, str]] = []
        self.fail = fail

    def send(self, chat_id: str, text: str):
        if self.fail:
            raise RuntimeError("chat_id is empty")
        self.sent.append((chat_id, text))
        return [{}]


@pytest.fixture
def ready_link(db: Path) -> str:
    """One customer with a generated link, not yet delivered."""
    with ledger.connect(db) as conn:
        ledger.add_customer(conn, "C0001", display_name="Test",
                            zalo_user_id="u1", private_chat_id="u1")
        ledger.record_link_request(conn, "R00000000001", "C0001",
                                   "https://s.shopee.vn/x", None, 9_263, "zalo")
        ledger.attach_affiliate_url(conn, "R00000000001",
                                    "https://s.shopee.vn/aff", 9_263)
    return "R00000000001"


class TestLinkDelivery:
    def test_a_ready_link_is_sent(self, db, ready_link):
        bot = FakeBot()
        sent = convo.deliver_ready_links(db, bot, 0.70, "30-70 ngay",
                                         third_party=False)
        assert sent == 1
        chat_id, text = bot.sent[0]
        assert chat_id == "u1"
        assert "https://s.shopee.vn/aff" in text

    def test_it_is_not_sent_twice(self, db, ready_link):
        bot = FakeBot()
        convo.deliver_ready_links(db, bot, 0.70, "30-70 ngay", third_party=False)
        again = convo.deliver_ready_links(db, bot, 0.70, "30-70 ngay",
                                          third_party=False)
        assert again == 0
        assert len(bot.sent) == 1

    def test_a_failed_send_is_retried_next_pass(self, db, ready_link):
        """Marking it delivered before the send succeeds loses the link."""
        convo.deliver_ready_links(db, FakeBot(fail=True), 0.70, "30-70 ngay",
                                  third_party=False)
        bot = FakeBot()
        assert convo.deliver_ready_links(db, bot, 0.70, "30-70 ngay",
                                         third_party=False) == 1

    def test_a_customer_with_no_private_chat_is_skipped_not_crashed(self, db):
        with ledger.connect(db) as conn:
            ledger.add_customer(conn, "C0002", zalo_user_id="u2",
                                private_chat_id="")
            ledger.record_link_request(conn, "R00000000002", "C0002",
                                       "https://s.shopee.vn/y", None, 1_000, "zalo")
            ledger.attach_affiliate_url(conn, "R00000000002",
                                        "https://s.shopee.vn/aff2", 1_000)
        assert convo.deliver_ready_links(db, FakeBot(), 0.70, "30-70 ngay",
                                         third_party=False) == 0

    def test_no_estimate_still_delivers_the_link(self, db):
        """A link with no price attached must still reach the customer."""
        with ledger.connect(db) as conn:
            ledger.add_customer(conn, "C0001", zalo_user_id="u1",
                                private_chat_id="u1")
            ledger.record_link_request(conn, "R00000000003", "C0001",
                                       "https://shopee.vn/khong-co-gi",
                                       None, None, "zalo")
            ledger.attach_affiliate_url(conn, "R00000000003",
                                        "https://s.shopee.vn/aff3", None)
        bot = FakeBot()
        assert convo.deliver_ready_links(db, bot, 0.70, "30-70 ngay",
                                         third_party=False) == 1
        assert "https://s.shopee.vn/aff3" in bot.sent[0][1]


class TestOrderNotifications:
    def _order(self, db: Path, status: str = ledger.AWAITING_APPROVAL,
               cashback: int = 6_484):
        with ledger.connect(db) as conn:
            ledger.add_customer(conn, "C0001", zalo_user_id="u1",
                                private_chat_id="u1")
            ledger.add_order(conn, "O0001", "C0001", None,
                             order_value=97_500, estimated_commission=9_263)
            if status == ledger.APPROVED:
                ledger.mark_approved(conn, "O0001", 9_263, cashback)
            elif status == ledger.REJECTED:
                ledger.mark_rejected(conn, "O0001", "returned")

    def test_a_recorded_order_is_announced(self, db):
        self._order(db)
        bot = FakeBot()
        assert convo.notify_order_changes(db, bot, 0.70, "30-70 ngay") == 1
        assert "O0001" in bot.sent[0][1]

    def test_announced_once_not_on_every_pass(self, db):
        self._order(db)
        bot = FakeBot()
        convo.notify_order_changes(db, bot, 0.70, "30-70 ngay")
        assert convo.notify_order_changes(db, bot, 0.70, "30-70 ngay") == 0

    def test_a_new_status_is_announced_again(self, db):
        self._order(db)
        bot = FakeBot()
        convo.notify_order_changes(db, bot, 0.70, "30-70 ngay")
        with ledger.connect(db) as conn:
            ledger.mark_approved(conn, "O0001", 9_263, 6_484)
        assert convo.notify_order_changes(db, bot, 0.70, "30-70 ngay") == 1

    def test_approval_asks_for_a_bank_account_only_when_missing(self, db):
        self._order(db, ledger.APPROVED, cashback=PAYABLE)
        bot = FakeBot()
        convo.notify_order_changes(db, bot, 0.70, "30-70 ngay")
        assert "STK:" in bot.sent[0][1]

    def test_approval_names_the_account_when_it_is_known(self, db):
        self._order(db, ledger.APPROVED, cashback=PAYABLE)
        with ledger.connect(db) as conn:
            ledger.set_bank_details(conn, "C0001", "VCB", "0123456789", "NGUYEN A")
        bot = FakeBot()
        convo.notify_order_changes(db, bot, 0.70, "30-70 ngay")
        text = bot.sent[0][1]
        assert "0123456789" in text
        assert "STK:" not in text          # no need to ask again

    def test_a_rejection_carries_the_reason(self, db):
        self._order(db, ledger.REJECTED)
        bot = FakeBot()
        convo.notify_order_changes(db, bot, 0.70, "30-70 ngay")
        assert "returned" in bot.sent[0][1]


class TestApprovalNeverPromisesATransferItCannotMake:
    """The approval notice used to end "transferring to your account" on
    every approval, including balances far below the payout threshold.

    A customer told that, on 6,484 VND, watches their bank app for a week
    and concludes they were cheated. The message now depends on the
    balance, not on the single order that triggered it.
    """

    def _approved(self, db: Path, cashback: int, *, bank: bool):
        with ledger.connect(db) as conn:
            ledger.add_customer(conn, "C0001", zalo_user_id="u1",
                                private_chat_id="u1")
            if bank:
                ledger.set_bank_details(conn, "C0001", "VCB", "0123456789",
                                        "NGUYEN A")
            ledger.add_order(conn, "O0001", "C0001", None, order_value=97_500,
                             estimated_commission=int(cashback / 0.70))
            ledger.mark_approved(conn, "O0001", int(cashback / 0.70), cashback)
        bot = FakeBot()
        convo.notify_order_changes(db, bot, 0.70, "30-70 ngay")
        return bot.sent[0][1]

    def test_below_the_threshold_it_says_how_much_is_missing(self, db):
        text = self._approved(db, BELOW, bank=True)
        assert _vnd(payouts.MIN_PAYOUT_VND - BELOW) in text

    def test_below_the_threshold_it_does_not_say_it_is_transferring(self, db):
        text = self._approved(db, BELOW, bank=True)
        assert "0123456789" not in text

    def test_below_the_threshold_it_does_not_ask_for_a_bank_account(self, db):
        """Asking for an account number to send a sum that is not payable
        yet is what a scam looks like from the customer's side."""
        assert "STK:" not in self._approved(db, BELOW, bank=False)

    def test_at_the_threshold_it_names_the_account(self, db):
        assert "0123456789" in self._approved(db, PAYABLE, bank=True)

    def test_at_the_threshold_with_no_account_it_asks(self, db):
        assert "STK:" in self._approved(db, PAYABLE, bank=False)

    def test_the_threshold_is_reached_by_the_BALANCE_not_one_order(self, db):
        """Two small orders that add up are payable; neither is alone."""
        with ledger.connect(db) as conn:
            ledger.add_customer(conn, "C0001", zalo_user_id="u1",
                                private_chat_id="u1")
            ledger.set_bank_details(conn, "C0001", "VCB", "0123456789", "NGUYEN A")
            for n, amount in ((1, 30_000), (2, 25_000)):
                ledger.add_order(conn, f"O000{n}", "C0001", None,
                                 order_value=97_500, estimated_commission=40_000)
                ledger.mark_approved(conn, f"O000{n}", 40_000, amount)
        bot = FakeBot()
        convo.notify_order_changes(db, bot, 0.70, "30-70 ngay")
        # Both notices are sent after both orders exist, so both see the
        # combined 55,000 balance and both say a transfer is coming.
        assert all("0123456789" in text for _, text in bot.sent)


class TestFailedLinkApology:
    def test_a_given_up_request_gets_an_apology(self, db):
        with ledger.connect(db) as conn:
            ledger.add_customer(conn, "C0001", zalo_user_id="u1",
                                private_chat_id="u1")
            ledger.record_link_request(conn, "R00000000009", "C0001",
                                       "https://s.shopee.vn/bad", None, None, "zalo")
            conn.execute("UPDATE link_requests SET status='failed'"
                         " WHERE request_id='R00000000009'")
        bot = FakeBot()
        assert convo.notify_failed_links(db, bot) == 1
        assert convo.notify_failed_links(db, bot) == 0


class TestAProductWithNoCommission:
    """A real product that pays nothing is an answer, not a lookup failure.

    Treating zero as "could not look it up" sent the customer the generic
    message promising 70% of the commission -- of a commission that does
    not exist. They find out after buying.
    """

    def test_the_customer_is_told_plainly(self, db, monkeypatch):
        from cashback.shopee import commission as commission_lookup
        from cashback.ledger import repository as ledger

        with ledger.connect(db) as conn:
            ledger.add_customer(conn, "C0001", zalo_user_id="u1",
                                private_chat_id="u1")
            ledger.record_link_request(conn, "R00000000001", "C0001",
                                       "https://s.shopee.vn/x", None, None, "zalo")
            ledger.attach_affiliate_url(conn, "R00000000001",
                                        "https://s.shopee.vn/aff", None)

        zero = commission_lookup._build(100_000, 0.0, 0.0, "Khong hoa hong",
                                        commission_lookup.SOURCE_SHOPEE)
        monkeypatch.setattr(commission_lookup, "lookup", lambda *a, **k: zero)

        bot = FakeBot()
        assert convo.deliver_ready_links(db, bot, 0.70, "30-70 ngay",
                                         third_party=False) == 1
        text = bot.sent[0][1]
        assert "https://s.shopee.vn/aff" in text       # link still delivered
        assert "70%" not in text                       # nothing promised

    def test_zero_is_recognised_as_earning_nothing(self):
        from cashback.shopee import commission as c
        assert c._build(100_000, 0.0, 0.0, "x", c.SOURCE_SHOPEE).earns_nothing
        assert not c._build(100_000, 2.5, 7.0, "x", c.SOURCE_SHOPEE).earns_nothing


class TestTheTransferIsAnnounced:
    """The one thing the bot never said.

    The operator scanned the QR, the money landed, and the conversation
    stayed silent. The only proof the arrangement pays anything was a
    line in a bank app the customer had to think to check.
    """

    def _paid(self, db: Path, amounts: list[int], *, bank: bool = True):
        with ledger.connect(db) as conn:
            ledger.add_customer(conn, "C0001", zalo_user_id="u1",
                                private_chat_id="u1")
            if bank:
                ledger.set_bank_details(conn, "C0001", "VCB", "0123456789",
                                        "NGUYEN A")
            for n, amount in enumerate(amounts, 1):
                ledger.add_order(conn, f"O{n}", "C0001", None,
                                 order_value=97_500,
                                 estimated_commission=int(amount / 0.70))
                ledger.mark_approved(conn, f"O{n}", int(amount / 0.70), amount)
        convo.notify_order_changes(db, FakeBot(), 0.70, "30-70 ngay")
        with ledger.connect(db) as conn:
            for n, _ in enumerate(amounts, 1):
                ledger.mark_paid(conn, f"O{n}")
        bot = FakeBot()
        convo.notify_order_changes(db, bot, 0.70, "30-70 ngay")
        return bot

    def test_the_customer_is_told(self, db):
        assert len(self._paid(db, [PAYABLE]).sent) == 1

    def test_three_orders_paid_together_are_one_message(self, db):
        """One QR was scanned, so one transfer happened. Three messages
        would read as having been paid three times."""
        assert len(self._paid(db, [30_000, 25_000, 20_000]).sent) == 1

    def test_it_names_the_total_not_one_order(self, db):
        text = self._paid(db, [30_000, 25_000, 20_000]).sent[0][1]
        assert _vnd(75_000) in text

    def test_it_names_the_account_so_the_customer_can_check(self, db):
        assert "0123456789" in self._paid(db, [PAYABLE]).sent[0][1]

    def test_it_names_the_transfer_reference(self, db):
        """What the customer will actually see in their bank app."""
        assert "Hoan tien Shopee C0001" in self._paid(db, [PAYABLE]).sent[0][1]

    def test_an_account_we_do_not_have_is_not_printed_as_a_blank(self, db):
        text = self._paid(db, [PAYABLE], bank=False).sent[0][1]
        assert "Hoan tien Shopee C0001" in text
        assert "- - " not in text

    def test_it_is_said_once_not_on_every_pass(self, db):
        bot = self._paid(db, [PAYABLE])
        assert convo.notify_order_changes(db, bot, 0.70, "30-70 ngay") == 0
