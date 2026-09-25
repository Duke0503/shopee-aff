"""Orders whose sub_id1 is a customer code that no longer exists.

Customers were renumbered from C0003-style codes to Zalo UIDs, but Shopee
still reports the code each link was made with. Such an order used to be
filed for review every hour and then skipped -- so when Shopee approved
it, the ledger never heard, and the customer was never paid.
"""

from __future__ import annotations

import pytest

from cashback.core.policy import TaxPolicy
from cashback.ledger import repository as ledger
from cashback.shopee import reconciliation, report_reader

OWNER = "7654552834503557971"


def _row(sub_id1, sub_id2, status_text="PAID", item_status="Pending", order="260911QEWB75M1"):
    return report_reader._row_to_report_row({
        "utm_content": f"{sub_id1}-{sub_id2}---",
        "estimated_total_commission": 500_000_000,
        "orders": [{"order_sn": order, "order_status": status_text,
                    "items": [{"actual_amount": 10_000_000_000,
                               "display_item_status": item_status}]}],
    })


def _run(conn, *rows):
    return reconciliation.run(conn, list(rows), cashback_rate=0.80,
                              tax_policy=TaxPolicy.USER_ABSORBS,
                              period_is_withheld=False, source="test")


@pytest.fixture
def owner(conn):
    ledger.add_customer(conn, OWNER, zalo_user_id=OWNER)
    ledger.record_link_request(conn, "R26091053112", OWNER,
                               "https://shopee.vn/product/1/2", None, 5_000, "zalo")
    return conn


def test_an_old_code_is_attributed_through_its_link(owner):
    outcome = _run(owner, _row("C0003", "R26091053112"))
    assert outcome.needs_review == 0
    assert ledger.get_order(owner, "260911QEWB75M1")["customer_id"] == OWNER


def test_an_existing_order_still_gets_its_approval(owner):
    """The money bug: this order was skipped before its status was read."""
    ledger.add_order(owner, "260911QEWB75M1", OWNER, "R26091053112",
                     order_value=100_000, estimated_commission=5_000)
    row = _row("C0003", "R26091053112", status_text="COMPLETED", item_status="Validated")
    assert row.status == "approved"
    outcome = _run(owner, row)
    assert outcome.approved == 1
    order = ledger.get_order(owner, "260911QEWB75M1")
    assert order["status"] == ledger.APPROVED
    assert order["cashback_amount"] > 0


def test_nothing_to_go_on_is_filed_once_not_every_hour(owner):
    for _ in range(5):
        outcome = _run(owner, _row("C9999", "R00000000000"))
    assert outcome.needs_review == 1
    assert owner.execute("SELECT COUNT(*) FROM manual_review").fetchone()[0] == 1
    assert ledger.get_order(owner, "260911QEWB75M1") is None


def test_a_resolved_review_can_be_filed_again(owner):
    _run(owner, _row("C9999", "R00000000000"))
    owner.execute("UPDATE manual_review SET resolved=1")
    _run(owner, _row("C9999", "R00000000000"))
    assert owner.execute("SELECT COUNT(*) FROM manual_review").fetchone()[0] == 2
