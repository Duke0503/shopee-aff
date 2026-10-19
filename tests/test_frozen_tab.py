"""A Shopee tab that stops answering is replaced, and what replaced it is read.

On 19 Oct 2026 the tab froze while Shopee was showing a captcha. Every
script in it timed out, so nothing could say "captcha", and the alert that
went out said the extension was lost.
"""

from __future__ import annotations

import pytest

from cashback.shopee import link_generator as gen

AFFILIATE = gen.CUSTOM_LINK_URL


class TabBridge:
    """Answers only tab-level calls, like an extension whose page is frozen."""

    def __init__(self, fresh_url=AFFILIATE):
        self.tabs = [{"id": 1, "url": AFFILIATE}, {"id": 2, "url": "https://shopee.vn/"}]
        self.fresh_url = fresh_url
        self.closed = []

    def submit(self, job, timeout=None):
        if job.action == "get_tabs":
            return [dict(t) for t in self.tabs]
        if job.action == "navigate":
            assert job.params.get("_tab_scope") == gen.FRESH_TAB_SCOPE
            self.tabs.append({"id": 9, "url": self.fresh_url})
            return {"ok": True}
        if job.action == "close_tab":
            self.closed.append(job.params["tabid"])
            self.tabs = [t for t in self.tabs if t["id"] != job.params["tabid"]]
            return {"ok": True}
        raise RuntimeError("no result for execute_script within 20s")


@pytest.fixture(autouse=True)
def no_cooldown(monkeypatch):
    monkeypatch.setattr(gen, "_last_replaced", [0.0])
    monkeypatch.setattr(gen.time, "monotonic", lambda: 10_000.0)


class TestReplacingAFrozenTab:
    def test_the_frozen_tab_is_closed_and_the_fresh_one_kept(self):
        bridge = TabBridge()
        result = gen.replace_frozen_tab(bridge)
        assert bridge.closed == [1]                 # the old affiliate tab
        assert [t["id"] for t in bridge.tabs] == [2, 9]   # shopee.vn left alone
        assert result == {"href": AFFILIATE, "closed": 1}

    def test_a_captcha_in_the_fresh_tab_is_seen_without_running_a_script(self):
        bridge = TabBridge(fresh_url="https://affiliate.shopee.vn/verify/traffic?x=1")
        result = gen.replace_frozen_tab(bridge)
        assert "/verify/" in result["href"]

    def test_it_is_not_done_again_within_the_cooldown(self):
        bridge = TabBridge()
        gen.replace_frozen_tab(bridge)
        assert gen.replace_frozen_tab(bridge) == {}
        assert bridge.closed == [1]

    def test_an_extension_that_answers_nothing_gives_up_quietly(self):
        class Dead:
            def submit(self, job, timeout=None):
                raise RuntimeError("extension not connected")
        assert gen.replace_frozen_tab(Dead()) == {}


class TestTheAlertSaysWhatTheFreshTabShows:
    @pytest.fixture
    def alerts(self, monkeypatch):
        from cashback.core import telegram_alerts
        sent = []
        monkeypatch.setattr(telegram_alerts, "notify_shopee_captcha",
                            lambda hint="", current_url="": sent.append(("captcha", current_url)))
        monkeypatch.setattr(telegram_alerts, "notify_shopee_session_expired",
                            lambda hint="", current_url="": sent.append(("login", current_url)))
        monkeypatch.setattr(telegram_alerts, "notify_shopee_bridge_disconnected",
                            lambda: sent.append(("lost", "")))
        return sent

    def test_a_captcha_behind_a_frozen_tab_is_reported_as_a_captcha(self, alerts):
        bridge = TabBridge(fresh_url="https://affiliate.shopee.vn/verify/traffic")
        error = gen._fail(bridge, 1, "execute_script_timeout")
        assert alerts == [("captcha", "https://affiliate.shopee.vn/verify/traffic")]
        assert "slider" in error.hint

    def test_a_tab_that_simply_froze_is_replaced_without_an_alarm(self, alerts):
        gen._fail(TabBridge(), 1, "execute_script_timeout")
        assert alerts == []

    def test_no_extension_at_all_still_says_so(self, alerts):
        class Dead:
            def submit(self, job, timeout=None):
                raise RuntimeError("no result for get_tabs")
        gen._fail(Dead(), 1, "execute_script_timeout")
        assert alerts == [("lost", "")]


class TestTheOtherJobsOnTheSameTab:
    """The order report and payout sync use the same affiliate tab."""

    @pytest.fixture
    def alerts(self, monkeypatch):
        from cashback.core import telegram_alerts
        sent = []
        monkeypatch.setattr(telegram_alerts, "notify_shopee_captcha",
                            lambda hint="", current_url="": sent.append("captcha"))
        monkeypatch.setattr(telegram_alerts, "notify_shopee_bridge_disconnected",
                            lambda: sent.append("lost"))
        return sent

    @pytest.mark.parametrize("error", ["cdp_page_enable_timeout",
                                       "no result for execute_script within 120s"])
    def test_a_frozen_report_page_gets_a_fresh_tab(self, alerts, error):
        bridge = TabBridge()
        assert gen.recover_frozen_page(bridge, error) == "replaced"
        assert bridge.closed == [1] and alerts == []

    def test_a_captcha_found_while_reading_the_report_is_reported(self, alerts):
        bridge = TabBridge(fresh_url="https://affiliate.shopee.vn/verify/captcha")
        assert gen.recover_frozen_page(bridge, "cdp_page_enable_timeout") == "captcha"
        assert alerts == ["captcha"]

    def test_an_ordinary_error_touches_no_tab(self, alerts):
        bridge = TabBridge()
        assert gen.recover_frozen_page(bridge, "the dashboard did not return the report") == ""
        assert bridge.closed == [] and alerts == []
