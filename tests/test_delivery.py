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

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from cashback.ledger import repository as ledger
from cashback.messaging import notifications as convo

# A small balance. There is no minimum any more, so this is payable like
# any other -- which is the point of the class that uses it.
BELOW = 6_484
PAYABLE = 62_000


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


@pytest.fixture(autouse=True)
def fresh_backoff():
    convo._backoff.clear()
    yield
    convo._backoff.clear()


@pytest.fixture(autouse=True)
def no_assistant_wait(monkeypatch):
    """Most tests here are about what the message says, not when it goes.

    A link made seconds ago is normally the assistant's to hand over;
    TestWhoseJobALinkIs covers that timing with the real window.
    """
    monkeypatch.setattr(convo, "ASSISTANT_WAIT", timedelta(seconds=-1))


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

    def test_a_failed_send_is_retried_after_a_pause(self, db, ready_link):
        """Marking it delivered before the send succeeds loses the link;
        retrying on every pass hammers Zalo with the same failing call."""
        convo.deliver_ready_links(db, FakeBot(fail=True), 0.70, "30-70 ngay",
                                  third_party=False)
        bot = FakeBot()
        assert convo.deliver_ready_links(db, bot, 0.70, "30-70 ngay",
                                         third_party=False) == 0
        assert bot.sent == []
        # Once the pause is over it goes out.
        for key, (_, wait) in list(convo._backoff.items()):
            convo._backoff[key] = (convo.datetime.now(convo.timezone.utc), wait)
        assert convo.deliver_ready_links(db, bot, 0.70, "30-70 ngay",
                                         third_party=False) == 1

    def test_the_pause_doubles_and_stops_at_an_hour(self):
        for _ in range(12):
            convo._failed("k")
        assert convo._backoff["k"][1] == convo._BACKOFF_MAX
        convo._backoff.clear()
        convo._failed("k")
        first = convo._backoff["k"][1]
        convo._failed("k")
        assert convo._backoff["k"][1] == 2 * first

    def test_a_customer_with_no_old_bot_chat_is_reached_by_zalo_id(self, db):
        """private_chat_id came from the retired Bot API; almost nobody has
        one. Skipping them is how order news stopped reaching customers."""
        with ledger.connect(db) as conn:
            ledger.add_customer(conn, "C0002", zalo_user_id="u2",
                                private_chat_id="")
            ledger.record_link_request(conn, "R00000000002", "C0002",
                                       "https://s.shopee.vn/y", None, 1_000, "zalo")
            ledger.attach_affiliate_url(conn, "R00000000002",
                                        "https://s.shopee.vn/aff2", 1_000)
        bot = FakeBot()
        assert convo.deliver_ready_links(db, bot, 0.70, "30-70 ngay",
                                         third_party=False) == 1
        assert bot.sent[0][0] == "u2"

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


class TestApprovalSaysWhatHappensNext:
    """What follows the amount: read the account back, or ask for one.

    It must not name a date. When a balance is sent is the operator's
    call, and the customer hears about it from order_paid when it
    actually happens. A promised day that then slips is how a cashback
    group earns a reputation for not paying.
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

    def test_a_small_balance_is_treated_like_any_other(self, db):
        """6,484 VND used to be held back by a minimum nobody could see."""
        assert "0123456789" in self._approved(db, BELOW, bank=True)

    def test_it_names_the_account_it_will_send_to(self, db):
        assert "0123456789" in self._approved(db, PAYABLE, bank=True)

    def test_with_no_account_on_file_it_asks_for_one(self, db):
        assert "STK:" in self._approved(db, PAYABLE, bank=False)

    def test_it_promises_no_date(self, db):
        """When a balance moves is the operator's call. The customer is
        told it happened, by order_paid, not told when it will."""
        text = self._approved(db, PAYABLE, bank=True)
        for guess in ("hôm nay", "ngày mai", "trong ngày", "24h"):
            assert guess not in text.lower()

    def test_the_amount_shown_is_the_BALANCE_not_one_order(self, db):
        """Two orders, one balance: the note names the sum of both."""
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
        # Both notices go out after both orders exist, so both see the
        # combined 55,000 balance rather than their own order alone.
        assert all(_vnd(55_000) in text for _, text in bot.sent)


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
        assert "Hoan tien Shopee DP00001" in self._paid(db, [PAYABLE]).sent[0][1]

    def test_an_account_we_do_not_have_is_not_printed_as_a_blank(self, db):
        text = self._paid(db, [PAYABLE], bank=False).sent[0][1]
        assert "Hoan tien Shopee DP00001" in text
        assert "- - " not in text

    def test_it_is_said_once_not_on_every_pass(self, db):
        bot = self._paid(db, [PAYABLE])
        assert convo.notify_order_changes(db, bot, 0.70, "30-70 ngay") == 0


class TestWhoseJobALinkIs:
    """The assistant answers in the chat for ASSISTANT_WAIT; after that a
    link nobody collected is ours to send; after STALE_AFTER, nobody's."""

    @pytest.fixture(autouse=True)
    def real_window(self, monkeypatch):
        monkeypatch.setattr(convo, "ASSISTANT_WAIT", timedelta(seconds=35))

    def _age(self, db, request_id, seconds):
        stamp = (datetime.now(timezone.utc) - timedelta(seconds=seconds)).isoformat()
        with ledger.connect(db) as conn:
            conn.execute("UPDATE link_requests SET created_at=? WHERE request_id=?",
                         (stamp, request_id))

    def _notified(self, db, request_id):
        with ledger.connect(db) as conn:
            return conn.execute("SELECT notified_at FROM link_requests"
                                " WHERE request_id=?", (request_id,)).fetchone()[0]

    def test_a_link_the_assistant_may_still_collect_is_left_to_it(
            self, db, ready_link):
        self._age(db, ready_link, 10)
        bot = FakeBot()
        assert convo.deliver_ready_links(db, bot, 0.70, "30-70 ngay",
                                         third_party=False) == 0
        assert self._notified(db, ready_link) is None

    def test_a_link_finished_too_late_for_the_assistant_is_sent(
            self, db, ready_link):
        self._age(db, ready_link, 120)
        bot = FakeBot()
        assert convo.deliver_ready_links(db, bot, 0.70, "30-70 ngay",
                                         third_party=False) == 1
        assert bot.sent[0][0] == "u1"

    def test_a_stale_link_is_marked_but_never_sent(self, db, ready_link):
        self._age(db, ready_link, 3 * 3600)
        bot = FakeBot()
        assert convo.deliver_ready_links(db, bot, 0.70, "30-70 ngay",
                                         third_party=False) == 0
        assert bot.sent == []
        assert self._notified(db, ready_link) is not None

    def test_a_link_already_handed_over_is_not_sent_again(self, db, ready_link):
        self._age(db, ready_link, 120)
        with ledger.connect(db) as conn:
            ledger.mark_link_delivered(conn, ready_link)
        bot = FakeBot()
        assert convo.deliver_ready_links(db, bot, 0.70, "30-70 ngay",
                                         third_party=False) == 0

    def test_the_message_goes_to_the_zalo_id_not_the_old_bot_chat(self, db):
        with ledger.connect(db) as conn:
            ledger.add_customer(conn, "7654552834503557971",
                                zalo_user_id="7654552834503557971")
            ledger.record_link_request(conn, "R00000000009", "7654552834503557971",
                                       "https://s.shopee.vn/y", None, 1_000, "zalo_dm")
            ledger.attach_affiliate_url(conn, "R00000000009",
                                        "https://s.shopee.vn/aff9", 1_000)
        self._age(db, "R00000000009", 120)
        bot = FakeBot()
        convo.deliver_ready_links(db, bot, 0.70, "30-70 ngay", third_party=False)
        assert bot.sent[0][0] == "7654552834503557971"
