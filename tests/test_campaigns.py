"""Bonus campaigns: the first N customers in a window get a fixed bonus.

The rules customers were told: first recorded order wins, a slot belongs
to an order (one customer may win several), a cancelled order hands its
slot to the next order while the event runs, and the bonus is paid
together with that order's cashback once the order is approved.
"""

from __future__ import annotations

import pytest

from cashback.ledger import campaigns, payouts
from cashback.ledger import repository as ledger
from cashback.messaging import notifications

START, END = "2026-09-26T00:00:00+07:00", "2026-09-28T00:00:00+07:00"
INSIDE = "2026-09-26T10:00:00+07:00"


def _customer(conn, uid, role="user"):
    if role == "user":
        ledger.add_customer(conn, uid, zalo_user_id=uid, display_name=f"C{uid[-3:]}")
    else:
        conn.execute("INSERT INTO customers (customer_id, role, status, created_at)"
                     " VALUES (?, ?, 'active', ?)", (uid, role, ledger.now()))


def _order(conn, order_id, uid, minute=0, value=100_000, platform="shopee",
           day="2026-09-26"):
    ledger.add_order(conn, order_id, uid, None, order_value=value,
                     estimated_commission=5_000, platform=platform)
    conn.execute("UPDATE orders SET recorded_at=? WHERE order_id=?",
                 (f"{day}T10:{minute:02d}:00+07:00", order_id))


@pytest.fixture(autouse=True)
def during_the_event(monkeypatch):
    """Unless a test says otherwise, it is the middle of the event."""
    monkeypatch.setattr(campaigns, "_now", lambda: "2026-09-27T12:00:00+07:00")


@pytest.fixture
def event(conn):
    campaigns.create(conn, "tt2026", "Trung Thu", START, END, slots=3,
                     bonus_vnd=20_000, excluded_customers="999")
    return conn


def _holders(conn):
    return [r[0] for r in conn.execute(
        "SELECT customer_id FROM campaign_awards WHERE status != 'void' ORDER BY id")]


class TestWhoGetsASlot:
    def test_earliest_recorded_orders_win(self, event):
        for i, uid in enumerate(("111", "222", "333", "444")):
            _customer(event, uid)
            _order(event, f"O{uid}", uid, minute=10 - i)   # 444 recorded first
        campaigns.evaluate(event)
        assert set(_holders(event)) == {"444", "333", "222"}

    def test_one_customer_may_win_several_slots(self, event):
        _customer(event, "111")
        _customer(event, "222")
        _order(event, "A", "111", minute=1)
        _order(event, "B", "111", minute=2)
        _order(event, "C", "222", minute=3)
        _order(event, "D", "222", minute=4)
        campaigns.evaluate(event)
        assert _holders(event) == ["111", "111", "222"]
        assert campaigns.standing_for_order(event, "B").rank == 2
        assert campaigns.standing_for_order(event, "D") is None

    def test_a_per_customer_cap_is_honoured_when_set(self, conn):
        campaigns.create(conn, "cap", "Cap", START, END, slots=3, bonus_vnd=1,
                         per_customer=1)
        _customer(conn, "111")
        _customer(conn, "222")
        _order(conn, "A", "111", minute=1)
        _order(conn, "B", "111", minute=2)
        _order(conn, "C", "222", minute=3)
        campaigns.evaluate(conn)
        assert _holders(conn) == ["111", "222"]
        assert campaigns.missed_for_order(conn, "B") is None   # capped, not late

    def test_the_customers_cancelled_order_frees_a_slot_for_their_own_next(self, event):
        _customer(event, "111")
        for i, oid in enumerate(("A", "B", "C", "D")):
            _order(event, oid, "111", minute=i)
        campaigns.evaluate(event)
        ledger.mark_rejected(event, "B", "cancelled")
        campaigns.evaluate(event)
        live = [r[0] for r in event.execute(
            "SELECT order_id FROM campaign_awards WHERE status != 'void' ORDER BY id")]
        assert live == ["A", "C", "D"]

    def test_outside_the_window_never_counts(self, event):
        _customer(event, "111")
        _order(event, "A", "111", day="2026-09-25")
        _order(event, "B", "111", day="2026-09-28")
        campaigns.evaluate(event)
        assert _holders(event) == []

    def test_staff_house_and_excluded_never_hold_a_slot(self, event):
        _customer(event, "999")
        _customer(event, "admin", role="admin")
        _order(event, "A", "999")
        _order(event, "B", "admin")
        _order(event, "C", ledger.HOUSE_CUSTOMER_ID)
        campaigns.evaluate(event)
        assert _holders(event) == []

    def test_minimum_order_value_and_platforms_apply(self, conn):
        campaigns.create(conn, "x", "X", START, END, slots=5, bonus_vnd=1,
                         min_order_value=50_000, platforms="shopee")
        for uid in ("111", "222", "333"):
            _customer(conn, uid)
        _order(conn, "SMALL", "111", value=10_000)
        _order(conn, "TIKTOK", "222", platform="tiktok")
        _order(conn, "OK", "333")
        campaigns.evaluate(conn)
        assert _holders(conn) == ["333"]

    def test_a_rank_once_given_is_kept(self, event):
        _customer(event, "111")
        _order(event, "A", "111", minute=30)
        campaigns.evaluate(event)
        _customer(event, "222")
        _order(event, "B", "222", minute=5)   # recorded "earlier" but arrived later
        campaigns.evaluate(event)
        assert campaigns.standing_for_order(event, "A").rank == 2
        assert campaigns.standing_for_order(event, "B").rank == 1
        assert _holders(event) == ["111", "222"]


class TestSlotsFollowTheirOrder:
    @pytest.fixture
    def full(self, event):
        for i, uid in enumerate(("111", "222", "333", "444")):
            _customer(event, uid)
            _order(event, f"O{uid}", uid, minute=i)
        campaigns.evaluate(event)
        return event

    def test_a_cancelled_order_hands_its_slot_to_the_next_customer(self, full):
        ledger.mark_rejected(full, "O222", "cancelled")
        campaigns.evaluate(full)
        assert _holders(full) == ["111", "333", "444"]
        assert full.execute("SELECT status FROM campaign_awards WHERE order_id='O222'"
                            ).fetchone()[0] == campaigns.VOID

    def test_a_cancellation_after_the_end_frees_no_slot(self, full, monkeypatch):
        """The event is over: the cancelled order earns nothing, and the next
        customer is not promised a slot that no longer exists."""
        monkeypatch.setattr(campaigns, "_now", lambda: "2026-09-29T09:00:00+07:00")
        ledger.mark_rejected(full, "O222", "cancelled")
        campaigns.evaluate(full)
        assert _holders(full) == ["111", "333"]
        assert full.execute("SELECT status FROM campaign_awards WHERE order_id='O222'"
                            ).fetchone()[0] == campaigns.VOID

    def test_slots_still_follow_their_orders_after_the_end(self, full, monkeypatch):
        """Approval usually lands weeks later; the promise still holds."""
        monkeypatch.setattr(campaigns, "_now", lambda: "2026-11-02T09:00:00+07:00")
        ledger.mark_approved(full, "O111", 5_000, 3_600)
        campaigns.evaluate(full)
        assert campaigns.standing_for_order(full, "O111").status == campaigns.CONFIRMED

    def test_nothing_is_given_out_before_the_start(self, conn, monkeypatch):
        monkeypatch.setattr(campaigns, "_now", lambda: "2026-09-25T22:00:00+07:00")
        campaigns.create(conn, "tt2026", "Trung Thu", START, END, 3, 20_000)
        _customer(conn, "111")
        _order(conn, "A", "111", day="2026-09-25")
        campaigns.evaluate(conn)
        assert _holders(conn) == []

    def test_approval_confirms_and_payment_settles(self, full):
        ledger.mark_approved(full, "O111", 5_000, 3_600)
        campaigns.evaluate(full)
        assert campaigns.standing_for_order(full, "O111").status == campaigns.CONFIRMED
        ledger.mark_paid(full, "O111")
        assert campaigns.standing_for_order(full, "O111").status == campaigns.PAID

    def test_evaluating_again_changes_nothing(self, full):
        before = full.execute("SELECT id, customer_id, status FROM campaign_awards").fetchall()
        campaigns.evaluate(full)
        campaigns.evaluate(full)
        assert full.execute("SELECT id, customer_id, status FROM campaign_awards").fetchall() == before

    def test_the_database_refuses_a_second_live_slot_for_one_order(self, full):
        with pytest.raises(Exception):
            full.execute("INSERT INTO campaign_awards (campaign_id, customer_id, order_id,"
                         " amount, status, created_at) VALUES ('tt2026', '111', 'O111', 1, 'held', 'x')")

    def test_an_old_database_loses_the_one_per_customer_index(self, db):
        """Databases made before multi-slot campaigns had a unique index on
        (campaign, customer). The migration drops it and adds the column."""
        with ledger.connect(db) as conn:
            conn.execute("DROP INDEX IF EXISTS idx_award_customer_lookup")
            conn.execute("CREATE UNIQUE INDEX idx_award_customer ON campaign_awards"
                         "(campaign_id, customer_id) WHERE status != 'void'")
        ledger.initialise(db)
        with ledger.connect(db) as conn:
            names = {r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='index'")}
            columns = {r[1] for r in conn.execute("PRAGMA table_info(campaigns)")}
        assert "idx_award_customer" not in names
        assert "per_customer" in columns


class TestMoney:
    @pytest.fixture
    def winner(self, event):
        _customer(event, "111")
        ledger.set_bank_details(event, "111", "VCB", "0123456789", "NGUYEN A")
        _order(event, "O1", "111")
        campaigns.evaluate(event)
        return event

    def test_a_held_slot_is_not_payable(self, winner):
        assert payouts.collect(winner) == []

    def test_once_approved_the_bonus_is_paid_with_the_cashback(self, winner):
        ledger.mark_approved(winner, "O1", 5_000, 3_600)
        campaigns.evaluate(winner)
        [entry] = payouts.collect(winner)
        assert entry.amount == 3_600 + 20_000
        assert entry.bonus == 20_000

    def test_paid_once_never_again(self, winner):
        ledger.mark_approved(winner, "O1", 5_000, 3_600)
        campaigns.evaluate(winner)
        ledger.mark_paid(winner, "O1")
        campaigns.evaluate(winner)
        assert payouts.collect(winner) == []
        assert payouts.balance_for(winner, "111", 0.8).paid == 3_600 + 20_000

    def test_the_balance_shows_the_bonus_waiting(self, winner):
        balance = payouts.balance_for(winner, "111", 0.8)
        estimated_cashback = round(round(5_000 * (1 - 0.10 - 0.0098)) * 0.8)
        assert balance.awaiting == estimated_cashback + 20_000

    def test_without_any_campaign_nothing_changes(self, conn):
        _customer(conn, "111")
        _order(conn, "O1", "111")
        ledger.mark_approved(conn, "O1", 5_000, 3_600)
        campaigns.evaluate(conn)
        [entry] = payouts.collect(conn)
        assert entry.amount == 3_600 and entry.bonus == 0


class TestTheOfferInTheLinkReply:
    def test_offered_while_slots_are_left(self, event):
        _customer(event, "111")
        offer = campaigns.offer_for(event, "111", "shopee")
        assert offer == {"name": "Trung Thu", "bonus": 20_000, "slots": 3, "left": 3,
                         "min_order_value": 0, "per_customer": 0}

    def test_holding_a_slot_does_not_stop_the_offer(self, event):
        _customer(event, "111")
        _order(event, "A", "111")
        campaigns.evaluate(event)
        assert campaigns.offer_for(event, "111", "shopee")["left"] == 2

    def test_nothing_offered_before_the_start(self, event, monkeypatch):
        """Announced but not started: a link asked for now must not carry the
        campaign lines -- an order placed before the start never counts."""
        _customer(event, "111")
        monkeypatch.setattr(campaigns, "_now", lambda: "2026-09-25T23:59:59+07:00")
        assert campaigns.offer_for(event, "111", "shopee") is None
        monkeypatch.setattr(campaigns, "_now", lambda: "2026-09-26T00:00:00+07:00")
        assert campaigns.offer_for(event, "111", "shopee") is not None

    def test_nothing_offered_when_full_ended_or_ineligible(self, event, monkeypatch):
        for uid in ("111", "222", "333", "444"):
            _customer(event, uid)
        _customer(event, "999")
        _customer(event, "admin", role="admin")
        assert campaigns.offer_for(event, "999", "shopee") is None          # excluded
        assert campaigns.offer_for(event, "admin", "shopee") is None        # staff
        assert campaigns.offer_for(event, ledger.HOUSE_CUSTOMER_ID, "shopee") is None
        assert campaigns.offer_for(event, "111", "lazada") is None          # platform
        assert campaigns.offer_for(event, "nobody", "shopee") is None
        monkeypatch.setattr(campaigns, "_now", lambda: "2026-09-28T00:00:00+07:00")
        assert campaigns.offer_for(event, "111", "shopee") is None          # ended
        monkeypatch.setattr(campaigns, "_now", lambda: "2026-09-27T12:00:00+07:00")
        for i, uid in enumerate(("111", "222", "333")):
            _order(event, f"O{uid}", uid, minute=i)
        campaigns.evaluate(event)
        assert campaigns.offer_for(event, "444", "shopee") is None          # full

    def test_the_wording_fills_every_placeholder(self):
        import json
        from pathlib import Path
        words = json.loads(Path("resources/messages.vi.json").read_text(encoding="utf-8"))
        text = (words["campaign_link_hint"].replace("{name}", "N").replace("{slots}", "20")
                .replace("{left}", "5").replace("{bonus}", "20.000d")
                .replace("{rule}", words["campaign_rule_unlimited"])
                .replace("{total}", words["campaign_link_total"].replace("{total}", "34.400d")))
        assert "{" not in text and "20 " in text


class TestWhatTheCustomerIsTold:
    class Bot:
        def __init__(self):
            self.sent = []

        def send(self, uid, text):
            self.sent.append((uid, text))

    @pytest.fixture(autouse=True)
    def fresh_backoff(self):
        notifications._backoff.clear()

    @staticmethod
    def _announce_recorded(db, bot):
        """What the serve loop does: settle slots, then tell about orders."""
        notifications.notify_campaign_changes(db, bot)
        notifications.notify_order_changes(db, bot, 0.8, "30-70 ngay")

    def test_a_new_order_that_wins_says_so_in_its_recorded_message(self, db):
        with ledger.connect(db) as conn:
            campaigns.create(conn, "tt2026", "Trung Thu", START, END, 3, 20_000)
            _customer(conn, "111")
            _order(conn, "O1", "111")
        bot = self.Bot()
        self._announce_recorded(db, bot)
        self._announce_recorded(db, bot)
        assert len(bot.sent) == 1
        uid, text = bot.sent[0]
        assert uid == "111" and "O1" in text and "#1/3" in text and "20.000" in text

    def test_a_new_order_without_a_slot_says_nothing_of_the_event(self, db):
        with ledger.connect(db) as conn:
            _customer(conn, "111")
            _order(conn, "O1", "111")
        bot = self.Bot()
        self._announce_recorded(db, bot)
        [(_, text)] = bot.sent
        assert "#1/" not in text and "Trung Thu" not in text

    def test_a_slot_handed_on_to_an_announced_order_gets_its_own_message(self, db):
        with ledger.connect(db) as conn:
            campaigns.create(conn, "tt2026", "Trung Thu", START, END, 1, 20_000)
            _customer(conn, "111")
            _customer(conn, "222")
            _order(conn, "O1", "111", minute=1)
            _order(conn, "O2", "222", minute=2)
        bot = self.Bot()
        self._announce_recorded(db, bot)
        assert len(bot.sent) == 2              # both told their order was recorded
        with ledger.connect(db) as conn:
            ledger.mark_rejected(conn, "O1", "cancelled")
        self._announce_recorded(db, bot)
        self._announce_recorded(db, bot)
        to_222 = [t for uid, t in bot.sent if uid == "222"]
        assert len(to_222) == 2 and "#1/1" in to_222[-1]

    def test_losing_the_slot_is_announced_once(self, db):
        with ledger.connect(db) as conn:
            campaigns.create(conn, "tt2026", "Trung Thu", START, END, 3, 20_000)
            _customer(conn, "111")
            _order(conn, "O1", "111")
        bot = self.Bot()
        self._announce_recorded(db, bot)
        with ledger.connect(db) as conn:
            ledger.mark_rejected(conn, "O1", "cancelled")
        notifications.notify_campaign_changes(db, bot)
        notifications.notify_campaign_changes(db, bot)
        lost = [t for _, t in bot.sent if "Trung Thu" in t and "#1/3" not in t]
        assert len(lost) == 1

    def test_a_slot_lost_after_the_end_does_not_promise_it_moved_on(self, db, monkeypatch):
        with ledger.connect(db) as conn:
            campaigns.create(conn, "tt2026", "Trung Thu", START, END, 3, 20_000)
            _customer(conn, "111")
            _order(conn, "O1", "111")
        bot = self.Bot()
        self._announce_recorded(db, bot)
        monkeypatch.setattr(campaigns, "_now", lambda: "2026-10-20T09:00:00+07:00")
        with ledger.connect(db) as conn:
            ledger.mark_rejected(conn, "O1", "cancelled")
        notifications.notify_campaign_changes(db, bot)
        lost = bot.sent[-1][1]
        ended = notifications.messages.render("campaign_slot_lost_ended", name="X", identity="")
        during = notifications.messages.render("campaign_slot_lost", name="X", identity="")
        assert lost.splitlines()[-1] == ended.splitlines()[-1]
        assert lost.splitlines()[-1] != during.splitlines()[-1]

    def test_donhang_says_where_each_order_stands(self, event):
        for i, uid in enumerate(("111", "222", "333", "444")):
            _customer(event, uid)
            _order(event, f"O{uid}", uid, minute=i)
        campaigns.evaluate(event)
        winner = "\n".join(notifications.order_history(event, "111", 0.8))
        late = "\n".join(notifications.order_history(event, "444", 0.8))
        assert "#1/3" in winner
        assert "3 su" in late          # "... after all 3 slots were taken"

    def test_a_cancelled_order_is_not_called_late(self, event):
        _customer(event, "111")
        for i in range(4):
            _order(event, f"O{i}", "111", minute=i)
        campaigns.evaluate(event)
        ledger.mark_rejected(event, "O1", "cancelled")
        campaigns.evaluate(event)
        assert campaigns.missed_for_order(event, "O1") is None
        assert campaigns.standing_for_order(event, "O1") is None

    def test_the_transfer_message_counts_the_bonus(self, db):
        with ledger.connect(db) as conn:
            campaigns.create(conn, "tt2026", "Trung Thu", START, END, 3, 20_000)
            _customer(conn, "111")
            ledger.set_bank_details(conn, "111", "VCB", "0123456789", "NGUYEN A")
            _order(conn, "O1", "111")
            campaigns.evaluate(conn)
            ledger.mark_approved(conn, "O1", 5_000, 3_600)
            campaigns.evaluate(conn)
            ledger.mark_paid(conn, "O1")
            conn.execute("UPDATE orders SET notified_status='approved' WHERE order_id='O1'")
        bot = self.Bot()
        notifications.notify_order_changes(db, bot, 0.8, "30-70 ngay")
        [(_, text)] = bot.sent
        assert "23.600" in text and "Trung Thu" in text
