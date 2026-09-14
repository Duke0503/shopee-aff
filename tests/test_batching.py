"""When a batch fires, and therefore how long a customer waits.

The window used to be the only trigger, so a single customer at a quiet
hour waited out the full two and a half minutes to be "batched" with
nobody. Generating the link itself takes about eight seconds; the rest was
the bot waiting on itself.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from cashback.ledger import repository as ledger
from cashback.worker import batch_queue


@pytest.fixture(autouse=True)
def clean_queue_state():
    """The trigger keeps module state; each test starts from cold."""
    batch_queue._in_flight.clear()
    batch_queue._last_pass_at = None
    yield
    batch_queue._in_flight.clear()
    batch_queue._last_pass_at = None


def _request(db, request_id: str, customer_id: str = "C0001", age_seconds: int = 0):
    created = (datetime.now() - timedelta(seconds=age_seconds)).isoformat()
    with ledger.connect(db) as conn:
        if not ledger.get_customer(conn, customer_id):
            ledger.add_customer(conn, customer_id, zalo_user_id=customer_id,
                                private_chat_id=customer_id)
        ledger.record_link_request(conn, request_id, customer_id,
                                   "https://s.shopee.vn/x", None, None, "zalo")
        conn.execute("UPDATE link_requests SET created_at=? WHERE request_id=?",
                     (created, request_id))


class TestIdleBrowserGoesImmediately:
    def test_first_request_after_startup_is_not_made_to_wait(self, db):
        _request(db, "R00000000001")
        assert len(batch_queue.collect(db, batch_queue.BatchSettings())) == 1

    def test_it_waits_again_right_after_a_pass(self, db):
        settings = batch_queue.BatchSettings()
        _request(db, "R00000000001")
        assert batch_queue.collect(db, settings)      # fires, marks the pass
        _request(db, "R00000000002")
        # The browser just ran; the second request batches instead.
        assert batch_queue.collect(db, settings) == []

    def test_it_goes_once_the_gap_has_passed(self, db):
        settings = batch_queue.BatchSettings(min_gap_seconds=20)
        _request(db, "R00000000001")
        batch_queue.collect(db, settings)
        _request(db, "R00000000002")
        batch_queue._last_pass_at = datetime.now() - timedelta(seconds=21)
        assert len(batch_queue.collect(db, settings)) == 1


class TestTheOtherTwoTriggersStillWork:
    def test_a_full_queue_goes_regardless_of_the_gap(self, db):
        settings = batch_queue.BatchSettings(max_size=3, min_gap_seconds=999)
        batch_queue._last_pass_at = datetime.now()
        for i in range(3):
            _request(db, f"R{i:011d}")
        assert len(batch_queue.collect(db, settings)) == 3

    def test_a_long_wait_goes_regardless_of_the_gap(self, db):
        settings = batch_queue.BatchSettings(window_seconds=150, min_gap_seconds=999)
        batch_queue._last_pass_at = datetime.now()
        _request(db, "R00000000001", age_seconds=151)
        assert len(batch_queue.collect(db, settings)) == 1

    def test_nothing_queued_means_nothing_to_do(self, db):
        assert batch_queue.collect(db, batch_queue.BatchSettings()) == []


class TestLeasing:
    def test_a_request_in_flight_is_not_handed_out_twice(self, db):
        settings = batch_queue.BatchSettings()
        _request(db, "R00000000001")
        assert batch_queue.collect(db, settings)
        batch_queue._last_pass_at = datetime.now() - timedelta(seconds=999)
        # Still leased, so it must not come round again.
        assert batch_queue.collect(db, settings) == []

    def test_releasing_puts_it_back(self, db):
        settings = batch_queue.BatchSettings()
        _request(db, "R00000000001")
        batch_queue.collect(db, settings)
        batch_queue.release("R00000000001")
        batch_queue._last_pass_at = datetime.now() - timedelta(seconds=999)
        assert len(batch_queue.collect(db, settings)) == 1


class TestSubIdsCarryAttribution:
    def test_customer_first_then_request(self, db):
        """sub_id1 is the customer. Without it an order belongs to nobody,
        and that cannot be repaired once the link is out."""
        _request(db, "R00000000001", customer_id="C0007")
        job = batch_queue.collect(db, batch_queue.BatchSettings())[0]
        assert job["sub_ids"] == ["C0007", "R00000000001"]


class TestAFailedRequestComesBack:
    """A submission that produced no link must be retried, not dropped.

    The customer is still waiting and the ledger still says pending; the
    only thing that failed was one attempt at the browser.
    """

    def test_a_failure_leaves_it_pending_and_counts_the_attempt(self, db):
        from cashback.worker import batch_queue as q
        _request(db, "R00000000001")
        q.collect(db, q.BatchSettings())
        q.apply_results(db, [{"request_id": "R00000000001",
                              "error": "no link came back"}])
        with ledger.connect(db) as conn:
            row = conn.execute(
                "SELECT status, attempts, affiliate_url FROM link_requests"
                " WHERE request_id='R00000000001'").fetchone()
        assert row["status"] == "pending"
        assert row["attempts"] == 1
        assert row["affiliate_url"] is None

    def test_it_is_handed_out_again_on_the_next_pass(self, db):
        from cashback.worker import batch_queue as q
        _request(db, "R00000000001")
        q.collect(db, q.BatchSettings())
        q.apply_results(db, [{"request_id": "R00000000001", "error": "boom"}])
        q._last_pass_at = datetime.now() - timedelta(seconds=999)
        assert len(q.collect(db, q.BatchSettings())) == 1

    def test_it_is_given_up_on_after_the_limit(self, db):
        from cashback.worker import batch_queue as q
        _request(db, "R00000000001")
        for _ in range(ledger.MAX_LINK_ATTEMPTS):
            q._last_pass_at = None
            q.collect(db, q.BatchSettings())
            q.apply_results(db, [{"request_id": "R00000000001", "error": "boom"}])
        with ledger.connect(db) as conn:
            status = conn.execute(
                "SELECT status FROM link_requests WHERE request_id='R00000000001'"
            ).fetchone()["status"]
        # 'failed' is what makes the apology sendable; pending forever is
        # what left a customer waiting all evening.
        assert status == "failed"
