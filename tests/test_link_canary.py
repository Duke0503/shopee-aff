"""The hourly test link: proves the Chrome tab works, and is never delivered.

On 16 Oct 2026 the tab switched to English overnight and the first sign was
a customer's failed link the next morning. The canary finds that first.
"""

from __future__ import annotations

import pytest

from cashback.worker import runner


@pytest.fixture
def page(monkeypatch):
    seen = []
    state = {"result": [{"request_id": "canary", "affiliate_url": "https://s.shopee.vn/x"}]}

    def generate(bridge, jobs):
        seen.extend(jobs)
        if isinstance(state["result"], Exception):
            raise state["result"]
        return state["result"]

    monkeypatch.setattr(runner.shopee_script, "generate", generate)
    monkeypatch.setattr(runner, "_canary_url", lambda db: "https://shopee.vn/product/1/2")
    return state, seen


class TestTheCanary:
    def test_it_is_never_made_for_a_customer(self, page):
        _, seen = page
        runner.run_canary(None, object(), runner.Totals())
        assert seen[0]["sub_ids"][0] == runner.CANARY_SUB_ID
        assert runner.CANARY_SUB_ID.isalnum()

    def test_a_working_page_clears_the_failure_streak(self, page):
        totals = runner.Totals(failing_streak=5)
        assert runner.run_canary(None, object(), totals) is True
        assert totals.failing_streak == 0

    def test_a_broken_page_counts_as_a_failure(self, page):
        state, _ = page
        state["result"] = RuntimeError("the link form never appeared")
        totals = runner.Totals()
        assert runner.run_canary(None, object(), totals) is False
        assert totals.failing_streak == 1

    def test_no_product_to_try_does_nothing(self, monkeypatch):
        monkeypatch.setattr(runner, "_canary_url", lambda db: None)
        assert runner.run_canary(None, object(), runner.Totals()) is None


class TestAZeroRateIsLookedUpAgain:
    @pytest.mark.parametrize("row, expected", [
        ({"name": "x", "price": 242_250, "shopee_rate": 0, "seller_rate": 0, "total_commission": 0}, False),
        ({"name": "x", "price": 242_250, "shopee_rate": 4.0, "seller_rate": 10.0, "total_commission": 33_915}, True),
        ({"name": "x", "price": 99_000, "shopee_rate": 0, "seller_rate": 3.0, "total_commission": 2_970}, True),
        ({"name": "", "price": 99_000, "shopee_rate": 4.0, "seller_rate": 0, "total_commission": 3_960}, False),
        ({"name": "x", "price": 0, "shopee_rate": 4.0, "seller_rate": 0, "total_commission": 0}, False),
        ({"name": "x", "price": 100_000, "shopee_rate": 0, "seller_rate": 0, "total_commission": 5_000}, True),
        (None, False),
    ])
    def test_only_a_real_commission_is_trusted_from_the_cache(self, row, expected):
        from cashback.web.dashboard import _has_commission
        assert _has_commission(row) is expected
