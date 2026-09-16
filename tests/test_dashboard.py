"""The end-of-day page, and the two buttons on it.

The page itself is a convenience. The buttons are not: one sends a real
message to a real person, the other records that money left the account.
"""

from __future__ import annotations

import pytest

from cashback.ledger import repository as ledger
from cashback.web import dashboard


def _approved(conn, order_id: str, customer_id: str, cashback: int,
              request_id: str | None = None):
    ledger.add_order(conn, order_id, customer_id, request_id,
                     order_value=100_000, estimated_commission=cashback)
    ledger.mark_approved(conn, order_id, cashback * 2, cashback)


@pytest.fixture
def populated(conn, db):
    ledger.add_customer(conn, "C0001", display_name="Xuan Phuoc",
                        zalo_user_id="u1", private_chat_id="u1")
    ledger.set_bank_details(conn, "C0001", "VCB", "0123456789", "NGUYEN A")
    ledger.record_link_request(conn, "R00000000001", "C0001",
                               "https://shopee.vn/product/1/2", None, 9_000, "zalo")
    ledger.attach_affiliate_url(conn, "R00000000001",
                                "https://s.shopee.vn/aff1", 9_000)
    _approved(conn, "O1", "C0001", 40_000, "R00000000001")
    _approved(conn, "O2", "C0001", 21_000)

    ledger.add_customer(conn, "C0002", display_name="Chua Gui STK",
                        zalo_user_id="u2", private_chat_id="u2")
    _approved(conn, "O3", "C0002", 88_000)

    ledger.add_customer(conn, "C0003", display_name="Con Thieu",
                        zalo_user_id="u3", private_chat_id="u3")
    ledger.set_bank_details(conn, "C0003", "TCB", "9876543210", "TRAN B")
    _approved(conn, "O4", "C0003", 6_131)
    conn.commit()
    return db


class TestSnapshot:
    def test_it_sorts_people_into_the_three_buckets(self, populated):
        data = dashboard.snapshot(populated)
        assert [p.customer_id for p in data["ready"]] == ["C0001"]
        assert [p.customer_id for p in data["no_bank"]] == ["C0002"]
        assert [p.customer_id for p in data["short"]] == ["C0003"]

    def test_the_total_counts_everyone_owed(self, populated):
        # 61,000 ready + 88,000 with no bank + 6,131 still short
        assert dashboard.snapshot(populated)["total"] == 155_131

    def test_orders_come_with_the_link_that_earned_them(self, populated):
        orders = dashboard.snapshot(populated)["orders"]["C0001"]
        assert len(orders) == 2
        with_link = [o for o in orders if o["affiliate_url"]]
        assert with_link[0]["affiliate_url"] == "https://s.shopee.vn/aff1"


class TestRendering:
    def test_a_ready_customer_gets_a_qr_and_their_amount(self, populated):
        page = dashboard.render(dashboard.snapshot(populated))
        assert "img.vietqr.io" in page
        assert "61.000d" in page

    def test_the_affiliate_link_is_clickable_for_checking(self, populated):
        page = dashboard.render(dashboard.snapshot(populated))
        assert "https://s.shopee.vn/aff1" in page

    def test_someone_without_bank_details_gets_the_ask_button(self, populated):
        page = dashboard.render(dashboard.snapshot(populated))
        assert "/ask-bank/C0002" in page

    def test_an_empty_ledger_says_so_rather_than_rendering_nothing(self, db):
        page = dashboard.render(dashboard.snapshot(db))
        assert dashboard.t("nothing_at_all") in page

    def test_customer_names_are_escaped(self, conn, db):
        ledger.add_customer(conn, "C0009", display_name="<script>x</script>",
                            private_chat_id="u9")
        ledger.set_bank_details(conn, "C0009", "VCB", "1", "A")
        _approved(conn, "O9", "C0009", 60_000)
        conn.commit()
        page = dashboard.render(dashboard.snapshot(db))
        assert "<script>x</script>" not in page
        assert "&lt;script&gt;" in page


class TestMarkPaid:
    def test_it_records_the_transfer(self, populated, conn):
        result = dashboard.mark_paid(
            _cfg(populated), "C0001", ["O1", "O2"])
        assert result["ok"] is True
        assert dashboard.snapshot(populated)["ready"] == []

    def test_paying_twice_is_refused(self, populated):
        cfg = _cfg(populated)
        dashboard.mark_paid(cfg, "C0001", ["O1", "O2"])
        again = dashboard.mark_paid(cfg, "C0001", ["O1", "O2"])
        assert again["ok"] is False

    def test_an_injected_id_is_rejected(self, populated):
        result = dashboard.mark_paid(_cfg(populated), "C0001'; DROP TABLE--", [])
        assert result["ok"] is False

    def test_order_ids_are_filtered_too(self, populated):
        result = dashboard.mark_paid(
            _cfg(populated), "C0001", ["O1'; DELETE FROM orders--"])
        assert result["ok"] is False
        assert dashboard.snapshot(populated)["ready"]     # nothing was touched


class TestAskForBank:
    def test_a_customer_with_no_private_chat_is_refused(self, conn, db):
        ledger.add_customer(conn, "C0007", display_name="No Chat")
        conn.commit()
        result = dashboard.ask_for_bank(_cfg(db), "C0007")
        assert result["ok"] is False

    def test_an_unknown_customer_is_refused(self, db):
        assert dashboard.ask_for_bank(_cfg(db), "C9999")["ok"] is False

    def test_an_injected_id_is_rejected(self, db):
        assert dashboard.ask_for_bank(_cfg(db), "../../etc")["ok"] is False


def _cfg(db_path):
    """A config object with just what the dashboard actions read."""
    from cashback.core.config import load
    cfg = load()
    object.__setattr__(cfg, "db_path", db_path)
    return cfg
