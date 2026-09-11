"""Money rules: how an approved commission is split.

ONE RULE ABOVE ALL (audit v8, section 4):
    Cashback is computed from the commission SHOPEE HAS APPROVED,
    never from the estimate the bot showed at link-creation time.

No commission rate is hard-coded anywhere in this system. Rates are only
ever read back from real data -- see metrics.py.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

# Shopee Affiliate service fee.
# Source: help.shopee.vn/portal/10/article/174381
#   - 0.98% of the total value the partner receives from the programme
#   - VAT INCLUDED
#   - Effective from the 16-31 July 2025 settlement period
#   - Shopee deducts it directly during the monthly settlement
#
# NOTE: applying 0.98% per order is an ALLOCATION used to reason about
# per-order economics. Close the monthly books using the ACTUAL fee shown
# on the settlement statement / invoice.
# Shopee caps ITS OWN share of the commission on a single order.
# The shop's XTRA top-up is not capped and rides on top.
#
#     total = min(price x shopee_rate, CAP) + price x seller_rate
#
# Verified against 18 products, every one of them reporting the same
# 40,000 and every one matching the formula to the dong. It bites
# hard: a 5,290,000 VND item at 7% + 3% is 198,700 with the cap and
# 529,000 without, so ignoring it would have the bot promise nearly
# three times what Shopee pays.
SHOPEE_COMMISSION_CAP_VND = 40_000

SERVICE_FEE_RATE = 0.0098

# Personal income tax withheld at source for individual affiliates.
# Source: help.shopee.vn/portal/10/article/163104
#   - 10% on any single payout of 2,000,000 VND or more
#   - This is TAX PREPAID AT SOURCE, not the final annual liability
WITHHOLDING_TAX_RATE = 0.10
WITHHOLDING_THRESHOLD_VND = 2_000_000


class TaxPolicy(str, Enum):
    """Who absorbs the 10% Shopee withholds?

    OWNER_ABSORBS
        The operator absorbs it. Customers always receive the advertised
        percentage. Operator keeps roughly 9% of gross commission.

    USER_ABSORBS
        The allocated withholding is deducted from the customer's cashback.
        Operator keeps roughly 19% of gross commission.

        WARNING: at roughly 8-10M VND of monthly commission every payout
        clears the 2M threshold, so every period is withheld, so customers
        NEVER receive the advertised percentage. Choosing this policy means
        you must advertise the number customers actually receive (e.g.
        advertise 70%, not 80%).
    """

    OWNER_ABSORBS = "owner_absorbs"
    USER_ABSORBS = "user_absorbs"


@dataclass(frozen=True)
class Split:
    """All amounts are whole VND. Never use floats for money."""

    approved_commission: int   # C - what Shopee approved
    service_fee: int           # F - allocated 0.98%
    withheld_tax: int          # T - allocated 10% (0 if period not withheld)
    nominal_cashback: int      # B - cashback_rate x C
    customer_receives: int     # U - what actually gets transferred
    operator_keeps: int        # M - before any operating cost

    @property
    def customer_share(self) -> float:
        c = self.approved_commission
        return self.customer_receives / c if c else 0.0

    @property
    def operator_share(self) -> float:
        c = self.approved_commission
        return self.operator_keeps / c if c else 0.0


def split_commission(
    approved_commission: int,
    cashback_rate: float,
    tax_policy: TaxPolicy,
    period_is_withheld: bool,
) -> Split:
    """Split one approved order.

    `approved_commission` must be the figure Shopee actually approved,
    never the bot's estimate.
    """
    if approved_commission <= 0:
        return Split(0, 0, 0, 0, 0, 0)

    fee = round(approved_commission * SERVICE_FEE_RATE)
    tax = round(approved_commission * WITHHOLDING_TAX_RATE) if period_is_withheld else 0
    nominal = round(approved_commission * cashback_rate)

    if tax_policy is TaxPolicy.USER_ABSORBS:
        receives = max(0, nominal - tax)
    else:
        receives = nominal

    keeps = approved_commission - fee - tax - receives
    return Split(approved_commission, fee, tax, nominal, receives, keeps)


def policy_warnings(
    tax_policy: TaxPolicy, cashback_rate: float, expected_monthly_commission: int
) -> list[str]:
    """Checks to surface before going live. Empty list means nothing to flag."""
    warnings: list[str] = []
    if tax_policy is not TaxPolicy.USER_ABSORBS:
        return warnings

    always_withheld = expected_monthly_commission >= WITHHOLDING_THRESHOLD_VND
    actual_share = cashback_rate - WITHHOLDING_TAX_RATE

    if always_withheld:
        warnings.append(
            f"Expected commission {expected_monthly_commission:,} VND/month is at or "
            f"above the {WITHHOLDING_THRESHOLD_VND:,} VND threshold, so every payout "
            f"period is withheld at {WITHHOLDING_TAX_RATE:.0%}."
        )
        warnings.append(
            f"Customers will NEVER receive {cashback_rate:.0%}. They always "
            f"receive {actual_share:.0%}."
        )
        warnings.append(
            f"Advertising '{cashback_rate:.0%}' is therefore false. Advertise "
            f"'{actual_share:.0%}' instead: it is stable and it is true."
        )
    else:
        warnings.append(
            f"Cashback will swing between {actual_share:.0%} and {cashback_rate:.0%} "
            f"depending on whether the month clears the "
            f"{WITHHOLDING_THRESHOLD_VND:,} VND threshold."
        )
        warnings.append(
            "Customers cannot see or control that variable. Two customers with "
            "identical orders will receive different amounts."
        )
    return warnings
