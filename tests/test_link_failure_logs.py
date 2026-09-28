"""When a link cannot be made, the log line must say why.

"cashback job error" in the extension and "could not fill the form" in the
backend told the operator nothing. Every failure now names its step (of
four) and what the tab showed at that moment, with the likely fix.
"""

from __future__ import annotations

import pytest

from cashback.shopee import link_generator as gen
from cashback.worker import runner

RIGHT_PAGE = {"href": gen.CUSTOM_LINK_URL, "title": "Custom Link", "password_box": False,
              "textarea": True, "result": True, "subs": 5,
              "buttons": ["Lay link"], "errors": []}


class ScriptedBridge:
    """Answers each script by what it looks for; page_state gets `state`."""

    def __init__(self, state=None, fill=None, click=None, read=None, fail_on=None):
        self.state = dict(RIGHT_PAGE, **(state or {}))
        self.fill = fill or {"ok": True}
        self.click = click or {"ok": True}
        self.read = read or {"ok": True, "links": ["https://s.shopee.vn/x"]}
        self.fail_on = fail_on

    def submit(self, job, timeout=None):
        code = job.params.get("code", "")
        if self.fail_on and self.fail_on in code:
            raise RuntimeError("no result for execute_script within 60s -- is the extension loaded?")
        if "password_box" in code:
            return {"result": self.state}
        if "payload" in code:
            return {"result": self.fill}
        if "wanted.test" in code:
            return {"result": self.click}
        if "deadline" in code:
            return {"result": self.read}
        return {"result": {"ok": True, "v": "", "href": self.state["href"]}}


def _convert(bridge):
    return gen.convert_chunk(bridge, ["https://shopee.vn/p"], ["C0001", "R0001"])


class TestEveryFailureSaysWhereAndWhy:
    def test_a_missing_link_box_on_the_right_page_points_at_the_selector(self):
        bridge = ScriptedBridge(state={"textarea": False},
                                fill={"ok": False, "why": "source textarea not found"})
        with pytest.raises(gen.LinkStepError) as err:
            _convert(bridge)
        text = str(err.value)
        assert "[step 2/4: fill the form]" in text
        assert "textarea=MISSING" in text and gen.CUSTOM_LINK_URL in text
        assert "SOURCE_TEXTAREA" in text

    def test_a_login_page_says_log_in(self):
        bridge = ScriptedBridge(state={"href": "https://shopee.vn/buyer/login", "password_box": True,
                                       "textarea": False},
                                fill={"ok": False, "why": "source textarea not found"})
        with pytest.raises(gen.LinkStepError) as err:
            _convert(bridge)
        assert "log in to affiliate.shopee.vn" in str(err.value)

    def test_a_renamed_button_lists_the_buttons_that_are_there(self):
        bridge = ScriptedBridge(state={"buttons": ["Tao link moi", "Huy"]},
                                click={"ok": False, "why": "submit button not found"})
        with pytest.raises(gen.LinkStepError) as err:
            _convert(bridge)
        text = str(err.value)
        assert "[step 3/4" in text and "Tao link moi" in text and "SUBMIT_BUTTON_TEXT" in text

    def test_shopee_refusing_is_reported_with_its_own_words(self):
        bridge = ScriptedBridge(read={"ok": False, "why": "shopee_error: Link khong hop le"},
                                state={"errors": ["Link khong hop le"]})
        with pytest.raises(gen.LinkStepError) as err:
            _convert(bridge)
        text = str(err.value)
        assert "[step 4/4" in text and "Link khong hop le" in text and "Shopee itself refused" in text

    def test_a_hung_tab_mid_step_names_the_step_and_says_reload(self):
        bridge = ScriptedBridge(fail_on="wanted.test")
        with pytest.raises(gen.LinkStepError) as err:
            _convert(bridge)
        text = str(err.value)
        assert "[step 3/4" in text and "reload the Shopee Affiliate tab" in text

    def test_a_verification_page_on_opening_says_drag_the_slider(self):
        bridge = ScriptedBridge(state={"href": "https://shopee.vn/verify/traffic/error"})
        with pytest.raises(gen.LinkStepError) as err:
            gen.open_page(bridge, settle_ms=0)
        text = str(err.value)
        assert "[step 1/4" in text and "drag the slider" in text

    def test_a_working_page_still_makes_the_link(self):
        assert _convert(ScriptedBridge()) == ["https://s.shopee.vn/x"]


class TestARunOfFailuresIsShouted:
    def test_three_failed_passes_raise_the_alarm_and_a_success_clears_it(self, caplog):
        totals = runner.Totals()
        with caplog.at_level("WARNING"):
            for _ in range(2):
                runner._note_failure(totals, "boom")
            assert "LINKS ARE FAILING" not in caplog.text
            runner._note_failure(totals, "boom")
        assert "LINKS ARE FAILING: 3 pass(es) in a row" in caplog.text
        assert "boom" in caplog.text
