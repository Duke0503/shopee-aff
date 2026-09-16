"""Reading the conversion report straight from the dashboard.

Every constant here was measured against what the page itself prints, so
the tests use the real figures from a real order rather than invented
ones. If Shopee changes the scale or the field names, these fail rather
than quietly paying the wrong amount.
"""

from __future__ import annotations

import pytest

from cashback.shopee import report_reader as reader


class TestMoneyScale:
    """Amounts arrive multiplied by 100,000.

    Taken from order 2609141J5XWTHY, checked against the page showing
    73.631 and 101.520.
    """

    def test_the_scale_is_what_was_measured(self):
        assert reader.MONEY_SCALE == 100_000

    @pytest.mark.parametrize("raw,dong", [
        (7_363_100_000, 73_631),        # actual_amount
        (10_152_000_000, 101_520),      # item_price
        (5_522_325, 55),                # already-small values still scale
        (552_232_500, 5_522),           # estimated_total_commission
        (214_235_000, 2_142),
    ])
    def test_converts_to_whole_dong(self, raw, dong):
        assert reader._money(raw) == dong

    def test_a_missing_amount_is_none_not_zero(self):
        """Zero would read as "no commission"; None reads as "not known"."""
        assert reader._money(None) is None
        assert reader._money("") is None


class TestSubIds:
    """utm_content carries all five sub_ids joined by "-"."""

    def test_the_real_shape(self):
        assert reader.parse_sub_ids("C0003-R26091441451---") == \
            ["C0003", "R26091441451", "", "", ""]

    def test_customer_and_request_come_out_in_order(self):
        subs = reader.parse_sub_ids("C0007-R26091412345---")
        assert subs[0] == "C0007"
        assert subs[1] == "R26091412345"

    def test_empty_content_does_not_crash(self):
        assert reader.parse_sub_ids("") == [""]
        assert reader.parse_sub_ids(None) == [""]


class TestStatusIsNeverGuessed:
    """A status nobody has documented must not decide anything about money."""

    @pytest.mark.parametrize("display,order,expected", [
        ("Pending", "PAID", "awaiting"),
        ("", "UNPAID", "awaiting"),       # buyer has not paid; never pays out
        ("Validated", "PAID", "approved"),
        ("Cancelled", "PAID", "rejected"),
        ("Invalid", "PAID", "rejected"),
    ])
    def test_known_states(self, display, order, expected):
        assert reader.map_status(display, order) == expected

    def test_an_unseen_status_is_unknown(self):
        assert reader.map_status("Something New", "ALSO NEW") == "unknown"

    def test_case_and_spacing_do_not_matter(self):
        assert reader.map_status("  pENDing ", "") == "awaiting"

    def test_the_readable_field_wins_over_the_order_field(self):
        """An order can be PAID while its commission is already cancelled."""
        assert reader.map_status("Cancelled", "PAID") == "rejected"


class TestRowConversion:
    """One real conversion, exactly as the dashboard returned it."""

    RAW = {
        "utm_content": "C0003-R26091441451---",
        "purchase_time": 1789441044,
        "checkout_id": "243053887298067",
        "conversion_status": 1,
        "estimated_total_commission": 552_232_500,
        "orders": [{
            "order_sn": "2609141J5XWTHY",
            "order_status": "PAID",
            "items": [{
                "actual_amount": 7_363_100_000,
                "item_commission": 184_077_500,
                "capped_brand_commission": 368_155_000,
                "display_item_status": "Pending",
                "item_name": "Tui Trang Diem",
            }],
        }],
    }

    def test_the_figures_match_the_page(self):
        row = reader._row_to_report_row(self.RAW)
        assert row.order_value == 73_631
        assert row.commission == 5_522

    def test_it_is_traceable_to_customer_and_request(self):
        row = reader._row_to_report_row(self.RAW)
        assert row.customer_code == "C0003"
        assert row.request_code == "R26091441451"

    def test_the_order_id_is_the_order_number(self):
        assert reader._row_to_report_row(self.RAW).order_id == "2609141J5XWTHY"

    def test_status_comes_from_the_readable_field(self):
        assert reader._row_to_report_row(self.RAW).status == "awaiting"

    def test_commission_falls_back_to_the_item_parts(self):
        """Without the row total, Shopee's share plus the shop's XTRA."""
        raw = dict(self.RAW)
        raw.pop("estimated_total_commission")
        row = reader._row_to_report_row(raw)
        assert row.commission == 1_841 + 3_682      # 5,523, rounded per part

    def test_several_items_are_summed_into_one_order(self):
        raw = dict(self.RAW)
        raw["orders"] = [{
            "order_sn": "X1", "order_status": "PAID",
            "items": [
                {"actual_amount": 1_000_000_000, "display_item_status": "Pending"},
                {"actual_amount": 2_000_000_000, "display_item_status": "Pending"},
            ],
        }]
        assert reader._row_to_report_row(raw).order_value == 30_000

    def test_a_conversion_with_no_order_does_not_crash(self):
        row = reader._row_to_report_row({"utm_content": "C1-R1---",
                                         "checkout_id": "999"})
        assert row.order_id == "999"
        assert row.order_value is None


class TestUnpaidOrdersAreNotEarnings:
    """An unpaid order still reports a full commission breakdown.

    Shopee computes what it WOULD earn -- 2.5% plus the shop's XTRA, to
    the dong -- and then prints a dash for it, because the buyer has not
    paid. Anything reading this API has to keep that distinction or it
    will show money that does not exist as money already made.
    """

    UNPAID = {
        "utm_content": "C0003-R26091441451---",
        "estimated_total_commission": 462_300_000,
        "orders": [{
            "order_sn": "26091558DJHJSQ",
            "order_status": "UNPAID",
            "items": [{
                "actual_amount": 6_164_000_000,
                "item_commission": 154_100_000,
                "capped_brand_commission": 308_200_000,
                "display_item_status": "Unpaid",
            }],
        }],
    }

    def test_an_unpaid_order_is_flagged(self):
        assert reader.buyer_has_paid(self.UNPAID) is False

    def test_a_paid_order_is_not(self):
        paid = {"orders": [{"order_status": "PAID",
                            "items": [{"display_item_status": "Pending"}]}]}
        assert reader.buyer_has_paid(paid) is True

    def test_it_still_never_reaches_a_payout(self):
        """Whatever the figure, an unpaid order sits in awaiting."""
        assert reader._row_to_report_row(self.UNPAID).status == "awaiting"

    def test_the_projected_figure_is_still_reported(self):
        """Hiding it would be worse: the operator wants to see what is
        coming, they just must not mistake it for earned."""
        assert reader._row_to_report_row(self.UNPAID).commission == 4_623


class TestOrderProgressIsNotCommissionApproval:
    """An order moving forward is not Shopee agreeing to pay.

    A real order changed from 'Pending' to 'Completed' between two reads.
    Completed means delivered and confirmed; the commission on it is
    validated separately, monthly. Mapping it to approved would have made
    it payable before anyone agreed to pay it.
    """

    @pytest.mark.parametrize("display", [
        "Completed", "Delivered", "Shipping", "To_ship", "Processing", "Pending",
    ])
    def test_every_stage_of_an_order_is_still_awaiting(self, display):
        assert reader.map_status(display, "COMPLETED") == "awaiting"

    def test_only_validation_marks_it_approved(self):
        assert reader.map_status("Validated", "COMPLETED") == "approved"

    def test_a_cancelled_commission_beats_a_completed_order(self):
        assert reader.map_status("Cancelled", "COMPLETED") == "rejected"

    def test_a_stage_nobody_has_seen_still_goes_to_a_human(self):
        assert reader.map_status("Teleported", "COMPLETED") == "unknown"


class TestTheEstimateSurvivesReconciliation:
    """The reader works out what an order would earn; it must reach the ledger.

    It was discarded, so the ledger held a blank and the customer was told
    the amount would be confirmed later -- when it was already known.
    """

    def test_reconciliation_stores_what_the_reader_computed(self, conn):
        from cashback.ledger import repository as ledger
        from cashback.shopee import reconciliation
        from cashback.core.policy import TaxPolicy

        ledger.add_customer(conn, "C0003", display_name="Xuan Phuoc",
                            private_chat_id="u1")
        row = reader._row_to_report_row({
            "utm_content": "C0003----",
            "estimated_total_commission": 552_232_500,
            "orders": [{
                "order_sn": "2609141J5XWTHY", "order_status": "PAID",
                "items": [{"actual_amount": 7_363_100_000,
                           "display_item_status": "Pending"}],
            }],
        })
        reconciliation.run(conn, [row], cashback_rate=0.80,
                           tax_policy=TaxPolicy.USER_ABSORBS,
                           period_is_withheld=False, source="test")
        stored = ledger.get_order(conn, "2609141J5XWTHY")
        assert stored["estimated_commission"] == 5_522
        assert stored["order_value"] == 73_631

    def test_an_order_recorded_without_an_estimate_gets_one_later(self, conn):
        """Rows already in the ledger are filled in on a later pass.

        The estimate was discarded for a while, so orders recorded then
        hold a blank. They should not stay blank forever.
        """
        from cashback.ledger import repository as ledger
        from cashback.shopee import reconciliation
        from cashback.core.policy import TaxPolicy

        ledger.add_customer(conn, "C0003", private_chat_id="u1")
        ledger.add_order(conn, "OLD1", "C0003", None,
                         order_value=73_631, estimated_commission=None)
        row = reader._row_to_report_row({
            "utm_content": "C0003----",
            "estimated_total_commission": 552_232_500,
            "orders": [{
                "order_sn": "OLD1", "order_status": "PAID",
                "items": [{"actual_amount": 7_363_100_000,
                           "display_item_status": "Pending"}],
            }],
        })
        reconciliation.run(conn, [row], cashback_rate=0.80,
                           tax_policy=TaxPolicy.USER_ABSORBS,
                           period_is_withheld=False, source="test")
        assert ledger.get_order(conn, "OLD1")["estimated_commission"] == 5_522

    def test_backfill_never_touches_an_approved_figure(self, conn):
        """Only mark_approved sets what is actually payable."""
        from cashback.ledger import repository as ledger
        from cashback.shopee import reconciliation
        from cashback.core.policy import TaxPolicy

        ledger.add_customer(conn, "C0003", private_chat_id="u1")
        ledger.add_order(conn, "OLD2", "C0003", None,
                         order_value=73_631, estimated_commission=None)
        ledger.mark_approved(conn, "OLD2", approved_commission=9_999,
                             cashback_amount=7_000)
        row = reader._row_to_report_row({
            "utm_content": "C0003----",
            "estimated_total_commission": 552_232_500,
            "orders": [{"order_sn": "OLD2", "order_status": "PAID",
                        "items": [{"actual_amount": 7_363_100_000,
                                   "display_item_status": "Pending"}]}],
        })
        reconciliation.run(conn, [row], cashback_rate=0.80,
                           tax_policy=TaxPolicy.USER_ABSORBS,
                           period_is_withheld=False, source="test")
        stored = ledger.get_order(conn, "OLD2")
        assert stored["approved_commission"] == 9_999
        assert stored["cashback_amount"] == 7_000
