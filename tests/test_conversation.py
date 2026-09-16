"""What an incoming message means, and what the bot says back.

Most of these guard bugs that customers actually hit. The nagging one is
the clearest: before it was fixed, typing "ok" got you asked for your bank
account, every time.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from cashback.ledger import repository as ledger
from cashback.messaging import conversation as convo
from cashback.messaging.zalo_client import Chat, Message


def send(db: Path, text: str, *, group: bool = False, user: str = "u1",
         name: str = "Test Person", event: str = "") -> list[convo.Reply]:
    message = Message(
        message_id="m1",
        chat=Chat(id="g1" if group else user, type="GROUP" if group else "USER"),
        text=text,
        from_user={"id": user, "display_name": name},
    )
    return convo.handle(db, message, 0.70, "30-70 ngay", event)


def first_text(replies: list[convo.Reply]) -> str:
    return replies[0].text if replies else ""


class TestLinkRecognition:
    """Every domain Shopee hands out. Missing one drops the customer.

    shp.ee was missing for a day: the lookup modules knew it, the handler
    did not, so those links were treated as ordinary chat.
    """

    @pytest.mark.parametrize("url", [
        "https://vn.shp.ee/QBYBEEQC",
        "https://s.shopee.vn/2LYC2vGLze",
        "https://shope.ee/abc123",
        "https://shopee.vn/product/1346334064/26971815798",
        "https://shopee.vn/Chuot-i.88201679.26971815798",
    ])
    def test_recognised(self, url):
        assert convo.find_shopee_urls(url) == [url]

    def test_found_in_the_middle_of_a_sentence(self):
        found = convo.find_shopee_urls("mua ho cai nay https://vn.shp.ee/AB1 nhe")
        assert found == ["https://vn.shp.ee/AB1"]

    def test_other_shops_are_ignored(self):
        assert convo.find_shopee_urls("https://tiki.vn/abc") == []

    def test_trailing_punctuation_is_trimmed(self):
        assert convo.find_shopee_urls("(https://vn.shp.ee/AB1)") == \
            ["https://vn.shp.ee/AB1"]


class TestCommandMatching:
    """People type commands without the slash, without diacritics, in caps."""

    @pytest.mark.parametrize("text,expected", [
        ("/huongdan", "/huongdan"),
        ("huong dan", "/huongdan"),
        ("HUONG DAN", "/huongdan"),
        ("ngan hang", "/nganhang"),
        ("/nganhang", "/nganhang"),
        ("@Bot DP Shopee Affiliate /huongdan", "/huongdan"),
    ])
    def test_understood(self, text, expected):
        assert convo.find_command(text) == expected

    @pytest.mark.parametrize("text", ["ok", "cam on", "hi", "bao nhieu tien"])
    def test_ordinary_chat_is_not_a_command(self, text):
        assert convo.find_command(text) == ""


class TestNoUnpromptedBankRequest:
    """The bot never asks for an account number on its own.

    Asking a stranger for bank details before a single dong exists reads
    exactly like a scam, and asking again on every "ok" is how a customer
    mutes the chat.
    """

    def test_greeting_does_not_ask(self, db):
        send(db, "hi")                       # first contact
        assert "tai khoan" not in first_text(send(db, "ok")).lower()

    @pytest.mark.parametrize("chatter", ["ok", "cam on", "alo", "the a"])
    def test_chatter_never_triggers_it(self, db, chatter):
        send(db, "hi")
        replies = send(db, chatter)
        assert len(replies) == 1             # one nudge, not two messages
        assert "STK:" not in replies[0].text

    def test_sending_a_link_does_not_trigger_it(self, db):
        send(db, "hi")
        replies = send(db, "https://vn.shp.ee/AB1")
        assert all("STK:" not in r.text for r in replies)

    def test_asking_explicitly_does(self, db):
        send(db, "hi")
        assert "STK:" in first_text(send(db, "/nganhang"))


class TestBankDetails:
    def test_parsed_from_the_documented_shape(self):
        bank = convo.parse_bank_details("STK: VCB - 0123456789 - NGUYEN VAN A")
        assert bank == {"bank": "VCB", "account": "0123456789",
                        "holder": "NGUYEN VAN A"}

    def test_spaces_inside_the_number_are_removed(self):
        bank = convo.parse_bank_details("STK: TCB - 0123 456 789 - TRAN B")
        assert bank["account"] == "0123456789"

    def test_a_non_numeric_account_is_refused(self):
        assert convo.parse_bank_details("STK: VCB - ABCDEFGH - NGUYEN VAN A") is None

    def test_saved_details_are_read_back(self, db):
        send(db, "hi")
        send(db, "STK: VCB - 0123456789 - NGUYEN VAN A")
        assert "0123456789" in first_text(send(db, "/nganhang"))


class TestReplyRouting:
    """Money goes private. A link shared in a group attributes to one person.

    Replying with a link in public would hand another buyer's order to the
    wrong customer's sub_id.
    """

    def test_bank_details_answered_privately_even_from_a_group(self, db):
        replies = send(db, "STK: VCB - 0123456789 - NGUYEN VAN A", group=True)
        assert all(r.chat_id != "g1" for r in replies)

    def test_first_contact_in_a_group_opens_a_private_chat_too(self, db):
        replies = send(db, "hi", group=True)
        assert any(r.chat_id == "g1" for r in replies)      # public greeting
        assert any(r.chat_id == "u1" for r in replies)      # private opener


class TestPlatformLimits:
    def test_a_stripped_link_preview_gets_instructions(self, db):
        replies = send(db, "", event=convo.UNSUPPORTED_EVENT)
        assert len(replies) == 1
        assert "x" in replies[0].text.lower()

    def test_an_unknown_command_lists_the_real_ones(self, db):
        send(db, "hi")
        text = first_text(send(db, "/khongcolenhnay"))
        assert "/huongdan" in text and "/nganhang" in text


class TestIdempotence:
    """Zalo cannot acknowledge an update, so a redelivery cannot be ruled out."""

    def test_handling_the_same_link_twice_makes_two_requests_not_a_crash(self, db):
        send(db, "hi")
        assert send(db, "https://vn.shp.ee/AB1")
        assert send(db, "https://vn.shp.ee/AB1")

    def test_a_repeat_greeting_does_not_create_a_second_customer(self, db):
        from cashback.ledger import repository as ledger
        send(db, "hi")
        send(db, "hi")
        with ledger.connect(db) as conn:
            count = conn.execute("SELECT COUNT(*) FROM customers").fetchone()[0]
        assert count == 1


class TestResendingAProductReusesTheLink:
    """Sending the same product again means "I never got it".

    Treating each send as a new request produced three links for one item,
    three trips to Shopee, and three near-identical messages the customer
    then had to choose between.
    """

    def test_a_second_send_makes_no_second_request(self, db):
        from cashback.ledger import repository as ledger
        send(db, "hi")
        send(db, "https://vn.shp.ee/SAME")
        send(db, "https://vn.shp.ee/SAME")
        with ledger.connect(db) as conn:
            count = conn.execute(
                "SELECT COUNT(*) FROM link_requests").fetchone()[0]
        assert count == 1

    def test_an_already_generated_link_is_queued_to_go_out_again(self, db):
        from cashback.ledger import repository as ledger
        send(db, "hi")
        send(db, "https://vn.shp.ee/SAME")
        with ledger.connect(db) as conn:
            request_id = conn.execute(
                "SELECT request_id FROM link_requests").fetchone()[0]
            ledger.attach_affiliate_url(conn, request_id,
                                        "https://s.shopee.vn/aff", 9_000)
            conn.execute("UPDATE link_requests SET notified_at=? "
                         "WHERE request_id=?", (ledger.now(), request_id))

        send(db, "https://vn.shp.ee/SAME")        # asked again
        with ledger.connect(db) as conn:
            row = conn.execute(
                "SELECT notified_at FROM link_requests").fetchone()
        assert row["notified_at"] is None         # queued for redelivery

    def test_a_different_product_still_makes_its_own_request(self, db):
        from cashback.ledger import repository as ledger
        send(db, "hi")
        send(db, "https://vn.shp.ee/AAA")
        send(db, "https://vn.shp.ee/BBB")
        with ledger.connect(db) as conn:
            count = conn.execute(
                "SELECT COUNT(*) FROM link_requests").fetchone()[0]
        assert count == 2

    def test_another_customer_asking_for_it_gets_their_own(self, db):
        from cashback.ledger import repository as ledger
        send(db, "hi", user="u1")
        send(db, "https://vn.shp.ee/SAME", user="u1")
        send(db, "hi", user="u2", name="Someone Else")
        send(db, "https://vn.shp.ee/SAME", user="u2", name="Someone Else")
        with ledger.connect(db) as conn:
            count = conn.execute(
                "SELECT COUNT(*) FROM link_requests").fetchone()[0]
        # Attribution is per customer; sharing one link would pay the wrong
        # person.
        assert count == 2

    def test_past_the_attribution_window_a_fresh_link_is_made(self, db):
        from cashback.ledger import repository as ledger
        from cashback.messaging import conversation as c
        from cashback.messaging.zalo_client import Chat, Message as M
        send(db, "hi")
        send(db, "https://vn.shp.ee/SAME")
        with ledger.connect(db) as conn:
            conn.execute("UPDATE link_requests SET created_at='2020-01-01T00:00:00+07:00'")
        msg = M(message_id="m", chat=Chat(id="u1", type="USER"),
                text="https://vn.shp.ee/SAME",
                from_user={"id": "u1", "display_name": "Test Person"})
        c.handle(db, msg, 0.70, "30-70 ngay", attribution_days=7)
        with ledger.connect(db) as conn:
            count = conn.execute(
                "SELECT COUNT(*) FROM link_requests").fetchone()[0]
        assert count == 2

    def test_a_resend_drops_the_stored_numbers_so_they_are_looked_up_again(self, db):
        """The link is reused; the price is not.

        Shopee prices move -- a flash sale is enough -- and quoting what the
        item cost last time is simply wrong.
        """
        from cashback.ledger import repository as ledger
        send(db, "hi")
        send(db, "https://vn.shp.ee/SAME")
        with ledger.connect(db) as conn:
            request_id = conn.execute(
                "SELECT request_id FROM link_requests").fetchone()[0]
            ledger.attach_affiliate_url(conn, request_id,
                                        "https://s.shopee.vn/aff", 9_000)
            conn.execute(
                "UPDATE link_requests SET notified_at=?, estimate_detail=?,"
                " estimate_source='shopee' WHERE request_id=?",
                (ledger.now(), '{"stale": true}', request_id))

        send(db, "https://vn.shp.ee/SAME")
        with ledger.connect(db) as conn:
            row = conn.execute(
                "SELECT affiliate_url, estimate_detail, estimated_commission"
                " FROM link_requests").fetchone()
        assert row["affiliate_url"] == "https://s.shopee.vn/aff"   # link kept
        assert row["estimate_detail"] is None                      # numbers dropped
        assert row["estimated_commission"] is None


class TestTheCustomerCanAskWhereTheirMoneyIs:
    """The payout threshold used to be invisible from the customer's side.

    A customer was told "you get 6,484" and then heard nothing for
    months, because 6,484 is below the threshold and nothing said so.
    From their side that is indistinguishable from being ignored, and
    the only way to find out was to ask a human.
    """

    def _balance(self, db: Path) -> str:
        return first_text(send(db, "/sodu"))

    def test_someone_with_no_orders_is_told_so_plainly(self, db):
        send(db, "hi")
        assert "chưa có đơn nào" in self._balance(db).lower()

    def test_an_order_awaiting_shopee_is_shown_as_awaiting(self, db):
        send(db, "hi")
        with ledger.connect(db) as conn:
            ledger.add_order(conn, "O1", "C0001", None, order_value=100_000,
                             estimated_commission=9_263)
        text = self._balance(db)
        assert "6.484" in text                  # 70% of the estimate
        assert "Shopee duyệt" in text

    def test_a_small_approved_balance_is_shown_as_owed_not_as_short(self, db):
        """6,484 used to be reported as 43,516 short of a minimum."""
        send(db, "hi")
        with ledger.connect(db) as conn:
            ledger.set_bank_details(conn, "C0001", "VCB", "0123456789", "A")
            ledger.add_order(conn, "O1", "C0001", None, order_value=100_000,
                             estimated_commission=9_263)
            ledger.mark_approved(conn, "O1", 9_263, 6_484)
        text = self._balance(db)
        assert "6.484" in text
        assert "43.516" not in text

    def test_a_payable_balance_says_the_money_is_coming(self, db):
        send(db, "hi")
        with ledger.connect(db) as conn:
            ledger.set_bank_details(conn, "C0001", "VCB", "0123456789", "A")
            ledger.add_order(conn, "O1", "C0001", None, order_value=900_000,
                             estimated_commission=90_000)
            ledger.mark_approved(conn, "O1", 90_000, 63_000)
        assert "chờ mình chuyển" in self._balance(db)

    def test_a_payable_balance_with_no_account_asks_for_one(self, db):
        send(db, "hi")
        with ledger.connect(db) as conn:
            ledger.add_order(conn, "O1", "C0001", None, order_value=900_000,
                             estimated_commission=90_000)
            ledger.mark_approved(conn, "O1", 90_000, 63_000)
        assert "/nganhang" in self._balance(db)

    def test_the_amount_is_never_sent_to_a_group(self, db):
        """What one customer earns is nobody else's business."""
        send(db, "hi", group=True)
        with ledger.connect(db) as conn:
            ledger.add_order(conn, "O1", "C0001", None, order_value=100_000,
                             estimated_commission=9_263)
            ledger.mark_approved(conn, "O1", 9_263, 6_484)
        replies = send(db, "/sodu", group=True)
        assert all(reply.chat_id != "g1" for reply in replies)


class TestNoMinimumIsMentionedAnywhere:
    """The minimum is gone, so no message may still describe one.

    A leftover sentence about gathering 50,000 would be worse than the
    rule ever was: a condition that is written down but not enforced.
    """

    def _messages(self):
        import json
        from cashback.core.config import PROJECT_ROOT
        return json.loads((PROJECT_ROOT / "resources" / "messages.vi.json")
                          .read_text(encoding="utf-8"))

    @pytest.mark.parametrize("word", ["50.000", "ngưỡng", "{threshold}"])
    def test_no_message_still_describes_a_minimum(self, word):
        blob = " ".join(v for k, v in self._messages().items()
                        if not k.startswith("_"))
        assert word not in blob

    def test_a_percentage_is_paired_with_a_worked_example(self, db):
        """"80% of commission" is not a number anyone can convert into
        money. The first thing a customer reads must name one."""
        greeting = first_text(send(db, "hi"))
        assert "200.000" in greeting and "hoa hồng 8%" in greeting
