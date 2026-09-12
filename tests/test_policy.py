"""The money rules.

This is the file to read first when auditing the arithmetic, and the one
to run before trusting a change to `core/policy.py`. Every figure here was
checked against Shopee's own published rates and against a real order.
"""

from __future__ import annotations

import pytest

from cashback.core.policy import (
    SERVICE_FEE_RATE,
    SHOPEE_COMMISSION_CAP_VND,
    WITHHOLDING_TAX_RATE,
    WITHHOLDING_THRESHOLD_VND,
    TaxPolicy,
    policy_warnings,
    split_commission,
)


class TestPublishedRates:
    """Constants that came from Shopee's own help pages.

    If one of these changes, it is because Shopee changed it -- not because
    someone tuned a number to make a spreadsheet work.
    """

    def test_service_fee_is_shopee_published_rate(self):
        # help.shopee.vn/portal/10/article/174381, VAT included,
        # effective from the 16-31 July 2025 settlement period.
        assert SERVICE_FEE_RATE == 0.0098

    def test_withholding_matches_vietnamese_law(self):
        # help.shopee.vn/portal/10/article/163104
        assert WITHHOLDING_TAX_RATE == 0.10
        assert WITHHOLDING_THRESHOLD_VND == 2_000_000

    def test_commission_cap_is_forty_thousand(self):
        # Verified against 18 products, all reporting the same cap.
        assert SHOPEE_COMMISSION_CAP_VND == 40_000


class TestRealOrder:
    """A real order the operator ran: Ga Chong Tham, 97,500 VND at 9.5%."""

    COMMISSION = 9_263
    RATE = 0.80

    def test_user_absorbs_withheld_month(self):
        split = split_commission(
            self.COMMISSION, self.RATE, TaxPolicy.USER_ABSORBS,
            period_is_withheld=True,
        )
        assert split.service_fee == 91          # 0.98%
        assert split.withheld_tax == 926        # 10%
        assert split.nominal_cashback == 7_410  # 80% of the gross
        assert split.customer_receives == 6_484  # nominal minus the tax
        assert split.operator_keeps == 1_762
        # Everything is accounted for; nothing appears or disappears.
        assert (split.service_fee + split.withheld_tax
                + split.customer_receives + split.operator_keeps) == self.COMMISSION

    def test_user_absorbs_quiet_month_pays_more(self):
        """Below the threshold nothing is withheld, so the customer gains.

        This is why the wording is "70%, some months 80%" rather than a
        single number: the customer cannot see or control which month it is.
        """
        split = split_commission(
            self.COMMISSION, self.RATE, TaxPolicy.USER_ABSORBS,
            period_is_withheld=False,
        )
        assert split.withheld_tax == 0
        assert split.customer_receives == 7_410
        assert split.customer_share == pytest.approx(0.80, abs=0.001)

    def test_owner_absorbs_pays_the_customer_the_same_either_way(self):
        withheld = split_commission(
            self.COMMISSION, self.RATE, TaxPolicy.OWNER_ABSORBS,
            period_is_withheld=True)
        quiet = split_commission(
            self.COMMISSION, self.RATE, TaxPolicy.OWNER_ABSORBS,
            period_is_withheld=False)
        assert withheld.customer_receives == quiet.customer_receives == 7_410
        # The operator carries the swing instead.
        assert withheld.operator_keeps < quiet.operator_keeps


class TestAdvertisedRateHonesty:
    """The audit finding that changed what the bot says out loud.

    Advertising 80% under user_absorbs is false at any realistic volume:
    every payout period clears the threshold, so the customer always
    receives 70%. The warnings exist so nobody re-enables that quietly.
    """

    def test_user_absorbs_at_volume_is_flagged_as_false_advertising(self):
        warnings = policy_warnings(TaxPolicy.USER_ABSORBS, 0.80, 9_000_000)
        assert warnings
        joined = " ".join(warnings)
        assert "NEVER receive 80%" in joined
        assert "70%" in joined

    def test_below_threshold_warns_about_the_swing(self):
        warnings = policy_warnings(TaxPolicy.USER_ABSORBS, 0.80, 500_000)
        assert any("swing" in w for w in warnings)

    def test_owner_absorbs_has_nothing_to_flag(self):
        assert policy_warnings(TaxPolicy.OWNER_ABSORBS, 0.80, 9_000_000) == []


class TestEdges:
    def test_zero_commission_splits_into_nothing(self):
        split = split_commission(0, 0.80, TaxPolicy.USER_ABSORBS, True)
        assert split.customer_receives == 0
        assert split.operator_keeps == 0
        assert split.customer_share == 0.0

    def test_negative_commission_is_refused_not_inverted(self):
        """A refund or a correction must not turn into a payout."""
        split = split_commission(-5_000, 0.80, TaxPolicy.USER_ABSORBS, True)
        assert split.customer_receives == 0

    def test_customer_never_owes_money(self):
        """A tiny commission in a withheld month must floor at zero.

        At a low cashback rate the tax allocation can exceed the nominal
        cashback. The customer receives nothing; they are never billed.
        """
        split = split_commission(1_000, 0.05, TaxPolicy.USER_ABSORBS, True)
        assert split.customer_receives == 0
        assert split.nominal_cashback < split.withheld_tax

    def test_full_rate_leaves_the_operator_paying_the_fee(self):
        split = split_commission(10_000, 1.0, TaxPolicy.OWNER_ABSORBS, False)
        assert split.customer_receives == 10_000
        assert split.operator_keeps == -98        # the 0.98% service fee
