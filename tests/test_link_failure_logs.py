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

    def __init__(self, state=None, fill=None, click=None, read=None, fail_on=None,
                 form_after=0):
        self.state = dict(RIGHT_PAGE, **(state or {}))
        self.form_after = form_after      # form shows after this many looks (-1: never)
        self.looks = 0
        self.navigations = 0
        self.fill = fill or {"ok": True}
        self.click = click or {"ok": True}
        self.read = read or {"ok": True, "links": ["https://s.shopee.vn/x"]}
        self.fail_on = fail_on

    def submit(self, job, timeout=None):
        if job.action == "navigate":
            self.navigations += 1
            return {}
        code = job.params.get("code", "")
        if "ready: box && button" in code:
            self.looks += 1
            return {"result": {"ready": self.form_after >= 0 and self.looks > self.form_after}}
        if self.fail_on and self.fail_on in code:
            raise RuntimeError("no result for execute_script within 60s -- is the extension loaded?")
        if "password_box" in code:
            return {"result": self.state}
        if "payload" in code:
            return {"result": self.fill}
        if "wanted.test" in code:
            return {"result": self.click}
        if "errEl" in code and "password_box" not in code:
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
        bridge = ScriptedBridge(read={"ok": False, "error": "Link khong hop le"},
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


class TestThePageScriptsParse:
    """The scripts are JavaScript inside Python strings: one escape too few
    ("\r?\n" written as "\r?\n") puts a raw line break inside a regex, the
    page rejects the whole script, and every link fails at that step."""

    @pytest.mark.parametrize("name", ["_PAGE_STATE_TEMPLATE", "_READ_ONCE_TEMPLATE",
                                      "_FILL_TEMPLATE", "_CLICK_TEMPLATE", "_CLEAR_TEMPLATE",
                                      "_FORM_READY_TEMPLATE"])
    def test_node_accepts_it(self, name, tmp_path):
        import json
        import shutil
        import subprocess
        if not shutil.which("node"):
            pytest.skip("node not installed")
        values = {"sub_fields": json.dumps(["#a"]), "textarea": json.dumps("t"),
                  "result": json.dumps("r"), "previous": json.dumps(""), "label": json.dumps("x"),
                  "payload": json.dumps({"urls": ["u"], "sub_ids": ["a"]}),
                  "all_fields": json.dumps(["x"])}
        template = getattr(gen, name)
        code = template % {k: v for k, v in values.items() if f"%({k})" in template}
        script = tmp_path / "page.js"
        script.write_text("const f = () => " + code.strip() + ";\n", encoding="utf-8")
        run = subprocess.run(["node", "--check", str(script)], capture_output=True, text=True)
        assert run.returncode == 0, run.stderr



@pytest.fixture
def quick(monkeypatch):
    """No real waiting: the tests are about what happens, not how long."""
    monkeypatch.setattr(gen.time, "sleep", lambda s: None)
    monkeypatch.setattr(gen, "FORM_WAIT_SECONDS", (0.05, 0.05))


class TestAPageStillLoading:
    def test_the_form_is_waited_for_before_anything_is_typed(self, quick, monkeypatch):
        monkeypatch.setattr(gen, "FORM_WAIT_SECONDS", (5, 5))
        bridge = ScriptedBridge(form_after=3)
        gen.open_page(bridge, settle_ms=0)
        assert bridge.looks == 4 and bridge.navigations == 0

    def test_a_form_that_never_comes_gets_one_reload_then_a_page_error(self, quick):
        bridge = ScriptedBridge(form_after=-1)
        with pytest.raises(gen.LinkStepError) as err:
            gen.open_page(bridge, settle_ms=0)
        assert bridge.navigations == 1
        assert err.value.page_level and "[step 1/4" in str(err.value)
        assert "never appeared" in str(err.value)


class TestAPageFailureIsNotTheCustomersFailure:
    def _jobs(self, n):
        return [{"request_id": f"R{i:011d}", "source_url": f"https://shopee.vn/p{i}",
                 "sub_ids": ["C0001", f"R{i:011d}"]} for i in range(n)]

    def test_a_page_error_hands_the_rest_back_without_an_error_count(self, quick, monkeypatch):
        calls = []

        def chunk(bridge, urls, sub_ids, **kw):
            calls.append(urls)
            if len(calls) == 2:
                raise gen.LinkStepError(2, "could not fill the form: source textarea not found", "s", "h")
            return ["https://s.shopee.vn/ok"]

        monkeypatch.setattr(gen, "convert_chunk", chunk)
        monkeypatch.setattr(gen, "open_page", lambda *a, **k: None)
        results = gen.generate(ScriptedBridge(), self._jobs(3))
        assert results[0] == {"request_id": "R00000000000", "affiliate_url": "https://s.shopee.vn/ok"}
        assert [r.get("retry") for r in results[1:]] == [True, True]

    def test_shopee_refusing_a_product_still_counts(self):
        assert not gen.LinkStepError(4, "no link came back: shopee_error: x", "s", "h").page_level
        assert gen.LinkStepError(3, "could not submit: submit button not found", "s", "h").page_level

    def test_a_retry_result_uses_no_attempt(self, db):
        from cashback.ledger import repository as ledger
        from cashback.worker import batch_queue
        with ledger.connect(db) as conn:
            ledger.add_customer(conn, "C0001", zalo_user_id="C0001")
            ledger.record_link_request(conn, "R00000000001", "C0001", "https://shopee.vn/p", None, 1, "zalo")
        out = batch_queue.apply_results(db, [{"request_id": "R00000000001", "retry": True, "error": "page"}])
        assert out == {"stored": 0, "skipped": 1, "failed": 0}
        with ledger.connect(db) as conn:
            row = conn.execute("SELECT attempts, status FROM link_requests").fetchone()
        assert row["attempts"] == 0 and row["status"] != "failed"
