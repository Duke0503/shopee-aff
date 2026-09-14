"""How requests become submissions, and what attribution survives.

The failure this guards against is quiet: an order arrives two months
later carrying a sub_id that matches a customer but no request, and there
is no way to tell which of their links produced it.
"""

from __future__ import annotations

import pytest

from cashback.shopee import link_generator as gen
from cashback.shopee.page_selectors import LINKS_PER_SUBMIT, MAX_LINKS_PER_SUBMIT


class FakeBridge:
    """Records what was submitted instead of driving a browser."""

    def __init__(self):
        self.submissions: list[tuple[list[str], list[str]]] = []

    def submit(self, job, timeout=None):
        return {"result": {"ok": True, "href": gen.CUSTOM_LINK_URL}}


@pytest.fixture
def captured(monkeypatch):
    calls: list[tuple[list[str], list[str]]] = []

    def fake_chunk(bridge, urls, sub_ids, **kwargs):
        calls.append((list(urls), list(sub_ids)))
        return [f"https://s.shopee.vn/link{i}" for i in range(len(urls))]

    monkeypatch.setattr(gen, "convert_chunk", fake_chunk)
    monkeypatch.setattr(gen, "open_page", lambda *a, **k: None)
    monkeypatch.setattr(gen, "_pause", lambda *a, **k: None)
    return calls


def _jobs(customer: str, count: int) -> list[dict]:
    return [
        {"request_id": f"R{i:011d}", "source_url": f"https://s.shopee.vn/p{i}",
         "sub_ids": [customer, f"R{i:011d}"]}
        for i in range(count)
    ]


class TestOneUrlPerSubmission:
    def test_five_requests_become_five_submissions(self, captured):
        gen.generate(FakeBridge(), _jobs("C0001", 5))
        assert len(captured) == 5

    def test_every_submission_carries_its_request_id(self, captured):
        """This is the whole point: sub_id2 identifies the request.

        Sent five at a time it has to be dropped, because sub_ids cannot
        vary within one submission -- and then an order can be traced to a
        customer but never to the link that earned it.
        """
        gen.generate(FakeBridge(), _jobs("C0001", 3))
        for urls, sub_ids in captured:
            assert len(urls) == 1
            assert len(sub_ids) == 2          # customer AND request
            assert sub_ids[0] == "C0001"
            assert sub_ids[1].startswith("R")

    def test_the_configured_size_is_one(self):
        assert LINKS_PER_SUBMIT == 1
        assert MAX_LINKS_PER_SUBMIT == 5      # what the page would allow


class TestCustomersAreNeverMixed:
    def test_each_submission_belongs_to_one_customer(self, captured):
        jobs = _jobs("C0001", 2) + _jobs("C0002", 2)
        gen.generate(FakeBridge(), jobs)
        for _urls, sub_ids in captured:
            assert sub_ids[0] in ("C0001", "C0002")
        customers = {sub_ids[0] for _u, sub_ids in captured}
        assert customers == {"C0001", "C0002"}


class TestResultMapping:
    def test_each_request_gets_exactly_one_link(self, captured):
        results = gen.generate(FakeBridge(), _jobs("C0001", 4))
        assert len(results) == 4
        assert len({r["request_id"] for r in results}) == 4
        assert all(r.get("affiliate_url") for r in results)

    def test_a_failed_submission_only_fails_its_own_request(self, monkeypatch):
        calls = {"n": 0}

        def flaky(bridge, urls, sub_ids, **kwargs):
            calls["n"] += 1
            if calls["n"] == 2:
                raise RuntimeError("no link came back")
            return ["https://s.shopee.vn/ok"]

        monkeypatch.setattr(gen, "convert_chunk", flaky)
        monkeypatch.setattr(gen, "open_page", lambda *a, **k: None)
        monkeypatch.setattr(gen, "_pause", lambda *a, **k: None)

        results = gen.generate(FakeBridge(), _jobs("C0001", 3))
        errors = [r for r in results if r.get("error")]
        assert len(errors) == 1               # the other two still succeeded
        assert len(results) == 3

    def test_no_jobs_means_no_browser_work(self, captured):
        assert gen.generate(FakeBridge(), []) == []
        assert captured == []


class TestOneFailureDoesNotContaminateTheOthers:
    """The exact shape that went wrong this morning, in reverse.

    Three links go out one at a time. The second submission fails. The
    question that matters is what the second customer receives -- and the
    answer has to be nothing, not whatever was left in the result box from
    the first.
    """

    @pytest.fixture
    def flaky_browser(self, monkeypatch):
        """Models the result box: cleared, then filled -- or not."""
        state = {"box": "", "n": 0}
        seen: list[dict] = []

        def submit(bridge, urls, sub_ids, **kwargs):
            state["n"] += 1
            previous = state["box"]
            state["box"] = ""                      # convert_chunk clears it
            if state["n"] == 2:
                # The click did nothing: the box stays as the clear left it.
                seen.append({"request": sub_ids[1], "previous": previous,
                             "outcome": "failed"})
                raise RuntimeError("no link came back: timed out")
            state["box"] = f"https://s.shopee.vn/real{state['n']}"
            seen.append({"request": sub_ids[1], "previous": previous,
                         "outcome": state["box"]})
            return [state["box"]]

        monkeypatch.setattr(gen, "convert_chunk", submit)
        monkeypatch.setattr(gen, "open_page", lambda *a, **k: None)
        monkeypatch.setattr(gen, "_pause", lambda *a, **k: None)
        return seen

    def test_the_failed_request_gets_an_error_not_a_leftover_link(
            self, flaky_browser):
        results = gen.generate(FakeBridge(), _jobs("C0001", 3))
        by_request = {r["request_id"]: r for r in results}

        failed = by_request["R00000000001"]
        assert "error" in failed
        assert "affiliate_url" not in failed

    def test_the_other_two_get_their_own_distinct_links(self, flaky_browser):
        results = gen.generate(FakeBridge(), _jobs("C0001", 3))
        urls = [r["affiliate_url"] for r in results if r.get("affiliate_url")]
        assert len(urls) == 2
        assert len(set(urls)) == 2               # no two requests share one

    def test_the_third_submission_is_compared_against_an_empty_box(
            self, flaky_browser):
        """After a failure the box is empty, so the next answer is anything
        non-empty -- it cannot be mistaken for a link that was never made."""
        gen.generate(FakeBridge(), _jobs("C0001", 3))
        assert flaky_browser[2]["previous"] == ""

    def test_each_submission_is_compared_against_the_one_before_it(
            self, flaky_browser):
        """Not against a value cached at the start of the pass."""
        gen.generate(FakeBridge(), _jobs("C0001", 3))
        assert flaky_browser[0]["previous"] == ""          # nothing yet
        assert flaky_browser[1]["previous"] == "https://s.shopee.vn/real1"
