"""Commission estimates: the cap, the rounding, and the two sources.

Both of the bugs these guard against reached customers before they were
found. The cap one was the expensive kind: an 84.6 million dong motorbike
would have been quoted 2,368,800 VND of cashback and paid 28,000.
"""

from __future__ import annotations

import pytest

from cashback.core.policy import SHOPEE_COMMISSION_CAP_VND
from cashback.shopee.commission import SOURCE_SHOPEE, SOURCE_THIRD_PARTY, Estimate, _build
from cashback.shopee.dashboard_lookup import (
    keyword_from_name,
    parse_rate,
    parse_url,
    round_dong,
)


class TestRounding:
    """Money rounds half UP. Python's round() rounds half to EVEN.

    9262.5 became 9262 while every other tool in this market showed 9263.
    One dong is nothing to pay; a customer comparing two bots and seeing
    different figures has no way to tell which one is shading them.
    """

    def test_half_rounds_up_not_to_even(self):
        assert round_dong(9262.5) == 9263
        assert round_dong(2437.5) == 2438
        assert round(9262.5) == 9262     # what the bug looked like

    def test_ordinary_values_are_untouched(self):
        assert round_dong(6825.0) == 6825
        assert round_dong(6825.4) == 6825
        assert round_dong(6825.6) == 6826


class TestCommissionCap:
    """Shopee caps ITS share at 40,000 per order. XTRA rides on top uncapped.

        total = min(price x shopee_rate, CAP) + price x seller_rate

    Every case below is a real product, checked against an independent
    source that reports the already-capped figure.
    """

    @pytest.mark.parametrize("price,shopee,seller,expected", [
        (97_500,     2.5,  7.0,   9_263),    # Ga Chong Tham, under the cap
        (2_229_000,  2.5, 18.0, 441_220),    # cap bites, big XTRA survives
        (35_390_000, 2.5,  0.0,  40_000),    # cap is the entire commission
        (5_290_000,  7.0,  3.0, 198_700),    # cap plus uncapped XTRA
        (84_600_000, 4.0,  0.0,  40_000),    # Honda SH125i
    ])
    def test_matches_shopee(self, price, shopee, seller, expected):
        assert _build(price, shopee, seller, "x", SOURCE_SHOPEE).commission == expected

    def test_without_the_cap_an_expensive_item_is_wildly_overstated(self):
        estimate = _build(84_600_000, 4.0, 0.0, "Honda SH125i", SOURCE_SHOPEE)
        uncapped = round(84_600_000 * 4.0 / 100)
        assert uncapped == 3_384_000
        assert estimate.commission == 40_000
        assert estimate.is_capped

    def test_cap_applies_only_to_shopees_own_share(self):
        estimate = _build(5_290_000, 7.0, 3.0, "x", SOURCE_SHOPEE)
        assert estimate.shopee_part == SHOPEE_COMMISSION_CAP_VND
        assert estimate.seller_part == 158_700      # untouched by the cap

    def test_not_flagged_when_the_cap_is_not_reached(self):
        assert not _build(97_500, 2.5, 7.0, "x", SOURCE_SHOPEE).is_capped


class TestRateSemantics:
    """`default_commission_rate` is the TOTAL, XTRA already inside it.

    Adding it to `seller_commission_rate` double-counts. That bug turned a
    5.5% product into 8.5%.
    """

    def test_total_rate_is_the_sum_of_the_parts_not_a_third_number(self):
        estimate = _build(100_000, 2.5, 7.0, "x", SOURCE_SHOPEE)
        assert estimate.total_rate == 9.5

    def test_vietnamese_decimal_comma(self):
        assert parse_rate("7,5%") == 7.5
        assert parse_rate("12,5%") == 12.5
        assert parse_rate("5%") == 5.0
        assert parse_rate("0%") == 0.0

    def test_unparseable_rate_is_zero_not_an_exception(self):
        assert parse_rate(None) == 0.0
        assert parse_rate("") == 0.0
        assert parse_rate("khong biet") == 0.0


class TestUrlParsing:
    """Shopee hands out several URL shapes. Missing one loses the customer.

    The /opaanlp/ form is what a short link opened on a phone resolves to;
    the parser only knew /product/ and silently returned nothing.
    """

    @pytest.mark.parametrize("url,shop,item", [
        ("https://shopee.vn/product/1346334064/26971815798", "1346334064", "26971815798"),
        ("https://shopee.vn/opaanlp/997956858/19090086744?__mobile__=1", "997956858", "19090086744"),
        ("https://shopee.vn/Chuot-May-Tinh-i.88201679.26971815798", "88201679", "26971815798"),
    ])
    def test_every_known_shape(self, url, shop, item):
        parsed = parse_url(url)
        assert parsed is not None
        _slug, shop_id, item_id = parsed
        assert (shop_id, item_id) == (shop, item)

    def test_slug_is_only_present_in_the_named_form(self):
        assert parse_url("https://shopee.vn/Chuot-May-i.1.2")[0] == "Chuot May"
        assert parse_url("https://shopee.vn/product/11111/22222")[0] == ""

    def test_a_url_with_no_ids_returns_none(self):
        assert parse_url("https://shopee.vn/khong-co-gi") is None
        assert parse_url("") is None


class TestEstimateRoundTrip:
    def test_survives_being_stored_and_read_back(self):
        """Delivery reads the breakdown back from the ledger on a retry."""
        original = _build(97_500, 2.5, 7.0, "Ga Chong Tham", SOURCE_THIRD_PARTY)
        restored = Estimate.from_json(original.to_json())
        assert restored == original

    def test_corrupt_stored_json_yields_none_not_a_crash(self):
        assert Estimate.from_json("{not json") is None
        assert Estimate.from_json('{"unexpected": 1}') is None

    def test_cashback_is_a_share_of_the_capped_commission(self):
        estimate = _build(84_600_000, 4.0, 0.0, "x", SOURCE_SHOPEE)
        assert estimate.cashback(0.70) == 28_000

    def test_keyword_trims_a_stuffed_product_name(self):
        stuffed = "Chuot May Tinh Logitech G102 Lightsync game co day cau hinh RGB"
        assert keyword_from_name(stuffed) == "Chuot May Tinh Logitech G102 Lightsync"
