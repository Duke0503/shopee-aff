"""The three figures to measure over the first 100-300 orders.

These replace every guessed number. No commission rate, order value or
cancellation rate is hard-coded anywhere in this system.

    effective_commission_rate = approved commission / GMV of approved orders
    valid_rate                = approved orders / all orders that arose
    approved_aov              = GMV of approved orders / approved orders

Below 100 approved orders every figure reports `has_enough_data == False`.
Reading a figure that thin and treating it as fact is the most expensive
mistake available here.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

from ..ledger import repository as ledger
from ..core.policy import SERVICE_FEE_RATE, WITHHOLDING_TAX_RATE, TaxPolicy

MIN_ORDERS_TO_TRUST = 100    # audit v8 section 12: measure over the first 100-300
COMFORTABLE_SAMPLE = 300


@dataclass
class Metrics:
    # counts
    total_orders: int
    approved_orders: int
    rejected_orders: int
    awaiting_orders: int

    # the three that matter
    effective_commission_rate: float | None
    valid_rate: float | None
    approved_aov: int | None

    # money
    approved_gmv: int
    approved_commission: int
    paid_to_customers: int
    owed_to_customers: int

    # supporting
    total_link_requests: int
    link_conversion_rate: float | None
    pending_manual_review: int

    @property
    def has_enough_data(self) -> bool:
        return self.approved_orders >= MIN_ORDERS_TO_TRUST

    @property
    def confidence(self) -> str:
        n = self.approved_orders
        if n >= COMFORTABLE_SAMPLE:
            return "reasonable"
        if n >= MIN_ORDERS_TO_TRUST:
            return "usable"
        return f"INSUFFICIENT ({n}/{MIN_ORDERS_TO_TRUST} approved) - do not treat as fact"


def _scalar(conn: sqlite3.Connection, sql: str, *args) -> int:
    row = conn.execute(sql, args).fetchone()
    return int(row[0] or 0)


def compute(conn: sqlite3.Connection) -> Metrics:
    settled = (ledger.APPROVED, ledger.PAID)

    approved = _scalar(
        conn, "SELECT COUNT(*) FROM orders WHERE status IN (?,?)", *settled
    )
    rejected = _scalar(
        conn, "SELECT COUNT(*) FROM orders WHERE status=?", ledger.REJECTED
    )
    awaiting = _scalar(
        conn, "SELECT COUNT(*) FROM orders WHERE status=?", ledger.AWAITING_APPROVAL
    )
    total = approved + rejected + awaiting

    gmv = _scalar(
        conn,
        "SELECT SUM(order_value) FROM orders WHERE status IN (?,?)"
        " AND order_value IS NOT NULL",
        *settled,
    )
    commission = _scalar(
        conn,
        "SELECT SUM(approved_commission) FROM orders WHERE status IN (?,?)"
        " AND approved_commission IS NOT NULL",
        *settled,
    )

    requests = _scalar(conn, "SELECT COUNT(*) FROM link_requests")
    converted = _scalar(
        conn, "SELECT COUNT(*) FROM link_requests WHERE status=?", ledger.CONVERTED
    )

    return Metrics(
        total_orders=total,
        approved_orders=approved,
        rejected_orders=rejected,
        awaiting_orders=awaiting,
        effective_commission_rate=(commission / gmv) if gmv else None,
        # Denominator is every order that arose, not only those already settled.
        valid_rate=(approved / total) if total else None,
        approved_aov=int(gmv / approved) if approved else None,
        approved_gmv=gmv,
        approved_commission=commission,
        paid_to_customers=_scalar(
            conn, "SELECT SUM(cashback_amount) FROM orders WHERE status=?", ledger.PAID
        ),
        owed_to_customers=_scalar(
            conn,
            "SELECT SUM(cashback_amount) FROM orders WHERE status=? AND paid_at IS NULL",
            ledger.APPROVED,
        ),
        total_link_requests=requests,
        link_conversion_rate=(converted / requests) if requests else None,
        pending_manual_review=_scalar(
            conn, "SELECT COUNT(*) FROM manual_review WHERE resolved=0"
        ),
    )


def estimate_earnings(
    metrics: Metrics,
    cashback_rate: float,
    tax_policy: TaxPolicy,
    period_is_withheld: bool,
) -> dict:
    """What the operator keeps BEFORE any operating cost.

    Audit v8 section 17: this is not profit. It does not subtract hosting,
    transfer fees, referrals, marketing, customer support, reconciliation
    errors, or any year-end tax still owed.
    """
    commission = metrics.approved_commission
    if not commission:
        return {"no_data": True}

    fee = round(commission * SERVICE_FEE_RATE)
    tax = round(commission * WITHHOLDING_TAX_RATE) if period_is_withheld else 0
    nominal = round(commission * cashback_rate)
    receives = (
        max(0, nominal - tax) if tax_policy is TaxPolicy.USER_ABSORBS else nominal
    )
    keeps = commission - fee - tax - receives

    return {
        "no_data": False,
        "approved_commission": commission,
        "service_fee": fee,
        "withheld_tax": tax,
        "nominal_cashback": nominal,
        "customer_receives": receives,
        "operator_keeps_before_costs": keeps,
        "operator_share": keeps / commission,
        "caveat": "not profit - operating costs not deducted (audit v8 section 17)",
    }
