"""The commands an operator actually types, run end to end.

These existed for months with no test at all, and it cost exactly what
you would expect: rewriting the payout snapshot renamed a key, the CLI
kept reading the old one, and `cashback payouts` -- the command run
every evening before moving money -- crashed on a traceback. Every
module imported cleanly, so nothing else noticed.

A command that prints is still a command that runs code. These call
them the way the parser does and read what came out.
"""

from __future__ import annotations

import argparse

import pytest

from cashback.cli.commands import analysis, ledger_ops
from cashback.core.config import load
from cashback.ledger import repository as ledger


def _cfg(db_path):
    cfg = load()
    object.__setattr__(cfg, "db_path", db_path)
    return cfg


@pytest.fixture
def busy(conn, db):
    """One payable customer, one blocked on a bank account, one in flight."""
    ledger.add_customer(conn, "C0001", display_name="Xuan Phuoc",
                        zalo_user_id="u1", private_chat_id="u1")
    ledger.set_bank_details(conn, "C0001", "VCB", "0123456789", "NGUYEN A")
    ledger.add_order(conn, "O1", "C0001", None, order_value=100_000,
                     estimated_commission=20_000)
    ledger.mark_approved(conn, "O1", 20_000, 16_000)

    ledger.add_customer(conn, "C0002", display_name="Chua Gui STK",
                        private_chat_id="u2")
    ledger.add_order(conn, "O2", "C0002", None, order_value=200_000,
                     estimated_commission=30_000)
    ledger.mark_approved(conn, "O2", 30_000, 24_000)

    ledger.add_customer(conn, "C0003", display_name="Dang Cho",
                        private_chat_id="u3")
    ledger.record_link_request(conn, "R00000000001", "C0003",
                               "https://shopee.vn/x", None, 5_522, "zalo")
    conn.execute(
        "UPDATE link_requests SET estimate_detail=? WHERE request_id=?",
        ('{"commission":5522,"price":73631,"total_rate":7.5,'
         '"shopee_rate":2.5,"seller_rate":5.0,"shopee_part":1841,'
         '"seller_part":3682,"is_capped":false,'
         '"name":"Tui Trang Diem Dung Tich Lon","source":"shopee"}',
         "R00000000001"))
    ledger.add_order(conn, "O3", "C0003", "R00000000001",
                     order_value=73_631, estimated_commission=5_522)
    conn.commit()
    return db


class TestPayouts:
    """The command run every evening before any money moves."""

    def _run(self, db, capsys, qr: bool = False) -> str:
        code = ledger_ops.cmd_payouts(_cfg(db), argparse.Namespace(qr=qr))
        assert code == 0
        return capsys.readouterr().out

    def test_it_runs_at_all(self, busy, capsys):
        """It did not. A renamed key in the snapshot took it out."""
        assert self._run(busy, capsys)

    def test_it_lists_who_can_be_paid_now(self, busy, capsys):
        out = self._run(busy, capsys)
        assert "C0001" in out
        assert "0123456789" in out

    def test_it_separates_the_one_waiting_on_an_account_number(
            self, busy, capsys):
        out = self._run(busy, capsys)
        assert "C0002" in out
        assert "no bank details" in out

    def test_it_shows_what_is_still_in_flight(self, busy, capsys):
        """A command that prints nothing while orders are in flight
        reads as the bot having stopped."""
        out = self._run(busy, capsys)
        assert "Tui Trang Diem" in out
        assert "NOT payable" in out

    def test_the_in_flight_figure_is_the_customers_share(self, busy, capsys):
        """The snapshot already applied the rate. Applying it twice is
        how the console and the CLI quote the same order differently."""
        out = self._run(busy, capsys)
        assert "4,418" in out            # 80% of 5,522, halves upward

    def test_an_empty_ledger_says_so_rather_than_crashing(self, db, capsys):
        ledger_ops.cmd_payouts(_cfg(db), argparse.Namespace(qr=False))
        assert "Nothing awaiting payout" in capsys.readouterr().out


class TestStatus:
    def _run(self, db, capsys) -> str:
        assert ledger_ops.cmd_status(_cfg(db), argparse.Namespace()) == 0
        return capsys.readouterr().out

    def test_it_runs(self, db, capsys):
        assert self._run(db, capsys)

    def test_it_does_not_claim_links_are_simulated(self, db, capsys):
        """It said "SIMULATED (no credentials)" whenever the Open API
        keys were absent, which is always -- while the bot was making
        real links through the browser the whole time."""
        assert "SIMULATED" not in self._run(db, capsys)

    def test_it_names_the_reduced_rate_the_operator_has_to_honour(
            self, db, capsys):
        out = self._run(db, capsys)
        cfg = load()
        if cfg.reduced_cashback_rate < cfg.cashback_rate:
            assert f"{cfg.reduced_cashback_rate:.0%}" in out

    def test_it_mentions_no_payout_minimum(self, db, capsys):
        assert "Threshold" not in self._run(db, capsys)


class TestMetrics:
    def test_it_runs_on_an_empty_ledger(self, db, capsys):
        assert analysis.cmd_metrics(_cfg(db), argparse.Namespace(withheld=False)) == 0
        assert capsys.readouterr().out

    def test_it_refuses_to_present_thin_data_as_fact(self, busy, capsys):
        analysis.cmd_metrics(_cfg(busy), argparse.Namespace(withheld=False))
        out = capsys.readouterr().out
        assert "INSUFFICIENT" in out or "not yet meaningful" in out
