"""TikTok orders from AccessTrade /v1/transactions.

Shaped like the real response of 2026-09-25: one purchase reported as a
product line and a brand-bonus line, sub ids under _extra.sub_params.
"""

from __future__ import annotations

import pytest

from cashback.ledger import repository as ledger
from cashback.providers.accesstrade_reconciler import (
    normalize_transactions, sync_accesstrade_orders)

OLD_UID, NEW_UID = "8451665422773758470", "8344302025228627109"


def _lines(sub1=OLD_UID, status=0, confirmed=0):
    common = {"transaction_id": "586230164791134201", "status": status,
              "is_confirmed": confirmed, "transaction_time": "2026-09-24T14:35:54",
              "reason_rejected": "", "product_quantity": 1,
              "_extra": {"sub_params": {"sub1": sub1, "sub2": "R26092437902"}}}
    return [
        {**common, "commission": 0.0, "product_price": 89999.0, "is_brand_bonus": False},
        {**common, "commission": 4042.0, "product_price": 6299.0, "is_brand_bonus": True},
    ]


@pytest.fixture
def cfg(db):
    from cashback.core.config import load
    config = load()
    object.__setattr__(config, "db_path", db)
    return config


@pytest.fixture
def merged_customer(db):
    """Kieu Yen after the merge: the old UID is an alias of the new one."""
    with ledger.connect(db) as conn:
        ledger.add_customer(conn, NEW_UID, zalo_user_id=NEW_UID, display_name="Kieu Yen")
        conn.execute("INSERT INTO customer_aliases (alias, customer_id, created_at)"
                     " VALUES (?, ?, ?)", (OLD_UID, NEW_UID, ledger.now()))
        ledger.record_link_request(conn, "R26092437902", NEW_UID,
                                   "https://vt.tiktok.com/x", None, 4_042, "zalo_dm")
    return NEW_UID


class TestOneOrderFromItsLines:
    def test_product_and_bonus_lines_are_one_purchase(self):
        [order] = normalize_transactions(_lines())
        assert order.order_id == "586230164791134201"
        assert order.order_value == 96_298
        assert order.estimated_commission == 4_042
        assert order.customer_id == OLD_UID
        assert order.request_id == "R26092437902"

    def test_pending_until_accesstrade_confirms(self):
        assert normalize_transactions(_lines(status=1, confirmed=0))[0].status == "awaiting_approval"
        [approved] = normalize_transactions(_lines(status=1, confirmed=1))
        assert approved.status == "approved" and approved.approved_commission == 4_042

    def test_all_lines_rejected_is_a_rejection(self):
        assert normalize_transactions(_lines(status=2))[0].status == "rejected"


class TestSync:
    def test_the_order_lands_under_the_merged_customer(self, cfg, db, merged_customer):
        summary = sync_accesstrade_orders(cfg, transactions=_lines())
        assert summary.orders_new == 1
        with ledger.connect(db) as conn:
            order = ledger.get_order(conn, "586230164791134201")
            assert order["customer_id"] == NEW_UID
            assert order["platform"] == "tiktok"
            assert order["request_id"] == "R26092437902"
            assert order["status"] == ledger.AWAITING_APPROVAL

    def test_confirmation_later_approves_it(self, cfg, db, merged_customer):
        sync_accesstrade_orders(cfg, transactions=_lines())
        summary = sync_accesstrade_orders(cfg, transactions=_lines(status=1, confirmed=1))
        assert summary.approved == 1
        with ledger.connect(db) as conn:
            order = ledger.get_order(conn, "586230164791134201")
            assert order["status"] == ledger.APPROVED
            assert order["cashback_amount"] == round(4_042 * 0.9 * cfg.advertised_cashback_rate)

    def test_an_order_for_nobody_goes_to_a_human_once(self, cfg, db):
        for _ in range(3):
            summary = sync_accesstrade_orders(cfg, transactions=_lines(sub1=""))
        assert summary.needs_review == 1
        with ledger.connect(db) as conn:
            assert ledger.get_order(conn, "586230164791134201") is None
            assert conn.execute("SELECT COUNT(*) FROM manual_review").fetchone()[0] == 1

    def test_an_unknown_customer_is_never_invented(self, cfg, db):
        sync_accesstrade_orders(cfg, transactions=_lines(sub1="9999999999999999999"))
        with ledger.connect(db) as conn:
            assert ledger.get_customer(conn, "9999999999999999999") is None
