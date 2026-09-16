"""Rows reconciliation refused to guess at.

Reconciliation parks anything it cannot attribute with certainty, which
is the right call: guessing sends one customer's money to another. But a
parked row is a real order that may be really owed, and the queue was
reachable only by opening SQLite and knowing the table name. One row sat
there for a day because a status value Shopee started using was not in
the map yet -- and it stayed parked after the map was fixed, because
nothing ever re-read it.
"""

from __future__ import annotations

import argparse
import json

import pytest

from cashback.cli.commands import reports
from cashback.core import config
from cashback.ledger import repository as ledger

# The shape Shopee's report actually returns, cut down to the fields the
# reader looks at. Taken from a row that really was parked.
RAW = {
    "utm_content": "C0001-R26091053112---",
    "estimated_total_commission": 214_235_000,       # scaled by 100,000
    "orders": [{
        "order_sn": "260911QEWB75M1",
        "order_status": "COMPLETED",
        "items": [{
            "item_name": "Dap Ghim Hoc Sinh Van Phong Deli",
            "display_item_status": "Completed",
            "item_price": 5_900_000_000,
            "item_commission": 123_575_000,
            "platform_commission_rate": 2500,
            "actual_amount": 4_943_000_000,
        }],
    }],
}


def _park(db, reason: str, raw: dict = None, order_id: str = "260911QEWB75M1"):
    with ledger.connect(db) as conn:
        ledger.add_customer(conn, "C0001", display_name="Xuan Phuoc")
        ledger.flag_for_review(
            conn, order_id,
            json.dumps(raw if raw is not None else RAW, ensure_ascii=False),
            reason)
        conn.commit()


def _cfg(db):
    cfg = config.load()
    object.__setattr__(cfg, "db_path", db)
    return cfg


def _args(*, retry: bool = False, resolve: int | None = None):
    return argparse.Namespace(retry=retry, resolve=resolve)


def _pending(db) -> int:
    with ledger.connect(db) as conn:
        return conn.execute(
            "SELECT COUNT(*) FROM manual_review WHERE resolved=0").fetchone()[0]


class TestTheQueueIsVisible:
    def test_an_empty_queue_says_so(self, db, capsys):
        reports.cmd_review(_cfg(db), _args())
        assert "Nothing waiting" in capsys.readouterr().out

    def test_a_parked_row_names_its_reason(self, db, capsys):
        _park(db, "unrecognised status value")
        reports.cmd_review(_cfg(db), _args())
        assert "unrecognised status value" in capsys.readouterr().out

    def test_it_shows_the_sub_ids_so_the_order_can_be_traced(self, db, capsys):
        _park(db, "no sub_id1, cannot attribute to a customer")
        assert "C0001-R26091053112" in (
            reports.cmd_review(_cfg(db), _args()) or capsys.readouterr().out)

    def test_it_shows_the_item_and_both_statuses(self, db, capsys):
        _park(db, "unrecognised status value")
        reports.cmd_review(_cfg(db), _args())
        out = capsys.readouterr().out
        assert "Dap Ghim" in out
        assert "Completed" in out and "COMPLETED" in out

    def test_a_row_with_unreadable_raw_data_still_lists(self, db, capsys):
        """A broken row must not hide the rest of the queue."""
        with ledger.connect(db) as conn:
            ledger.flag_for_review(conn, "O1", "not json at all", "broken")
            conn.commit()
        assert reports.cmd_review(_cfg(db), _args()) == 0
        assert "broken" in capsys.readouterr().out


class TestRetryingAfterTheMappingIsFixed:
    """The case this exists for: a status Shopee started sending that the
    map did not know. Once the map knows it, the stored raw row can go
    back through without anyone re-downloading the report."""

    def test_a_row_the_map_now_understands_is_applied(self, db, capsys):
        _park(db, "unrecognised status value")
        reports.cmd_review(_cfg(db), _args(retry=True))
        with ledger.connect(db) as conn:
            assert ledger.get_order(conn, "260911QEWB75M1") is not None

    def test_and_is_then_cleared_from_the_queue(self, db):
        _park(db, "unrecognised status value")
        reports.cmd_review(_cfg(db), _args(retry=True))
        assert _pending(db) == 0

    def test_a_row_still_unattributable_stays_parked(self, db, capsys):
        """No sub_id means no customer, and no amount of retrying changes
        that. Clearing it would quietly drop a real order."""
        raw = dict(RAW, utm_content="")
        _park(db, "no sub_id1, cannot attribute to a customer", raw)
        reports.cmd_review(_cfg(db), _args(retry=True))
        assert _pending(db) == 1
        assert "can be applied yet" in capsys.readouterr().out

    def test_an_unparsable_row_is_counted_not_crashed_on(self, db, capsys):
        with ledger.connect(db) as conn:
            ledger.flag_for_review(conn, "O1", "{{{", "broken")
            conn.commit()
        assert reports.cmd_review(_cfg(db), _args(retry=True)) == 0
        assert _pending(db) == 1


class TestResolvingByHand:
    def test_it_clears_the_row(self, db, capsys):
        _park(db, "no sub_id1, cannot attribute to a customer")
        with ledger.connect(db) as conn:
            row_id = conn.execute("SELECT id FROM manual_review").fetchone()[0]
        assert reports.cmd_review(_cfg(db), _args(resolve=row_id)) == 0
        assert _pending(db) == 0

    def test_it_does_not_invent_an_order(self, db):
        """Resolving is an admission that a human dealt with it elsewhere,
        not an instruction to pay anybody."""
        _park(db, "no sub_id1, cannot attribute to a customer")
        with ledger.connect(db) as conn:
            row_id = conn.execute("SELECT id FROM manual_review").fetchone()[0]
        reports.cmd_review(_cfg(db), _args(resolve=row_id))
        with ledger.connect(db) as conn:
            assert conn.execute("SELECT COUNT(*) FROM orders").fetchone()[0] == 0

    def test_an_unknown_id_fails_rather_than_reporting_success(self, db):
        assert reports.cmd_review(_cfg(db), _args(resolve=999)) == 1

    def test_resolving_twice_fails_the_second_time(self, db):
        _park(db, "broken")
        with ledger.connect(db) as conn:
            row_id = conn.execute("SELECT id FROM manual_review").fetchone()[0]
        reports.cmd_review(_cfg(db), _args(resolve=row_id))
        assert reports.cmd_review(_cfg(db), _args(resolve=row_id)) == 1
