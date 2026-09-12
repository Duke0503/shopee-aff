"""What an incoming message means, and what the bot says back.

Most of these guard bugs that customers actually hit. The nagging one is
the clearest: before it was fixed, typing "ok" got you asked for your bank
account, every time.
"""

from __future__ import annotations

from pathlib import Path

import pytest

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
