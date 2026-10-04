"""Drive the Custom Link page to turn source URLs into affiliate links.

The page carries ONE set of sub_ids for the whole form, shared by every URL
in the textarea. Two customers therefore cannot go in the same submission:
their orders would come back from the conversion report with identical
sub_ids and could never be told apart. Work is grouped by customer first,
then chunked to the page's five-URL limit.

Selectors live in selectors.py. Nothing here hard-codes a class name.
"""

from __future__ import annotations

import json
import time
from collections import defaultdict

from ..shopee.browser_bridge import Bridge, Job
from ..core.identifiers import assert_valid_sub_id
from ..shopee.page_selectors import (
    CUSTOM_LINK_URL,
    LINKS_PER_SUBMIT,
    MAX_LINKS_PER_SUBMIT,
    RESULT_FIELD,
    SOURCE_TEXTAREA,
    SUB_ID_FIELDS,
    SUBMIT_BUTTON_TEXT,
)

CONNECTOR = "shopee_affiliate"

# antd inputs are React-controlled: assigning .value directly updates the DOM
# but never reaches React's state, so the form submits empty. Going through
# the native setter and firing the events React listens for is what makes the
# value stick.
_FILL_TEMPLATE = """
(() => {
  const setValue = (el, value) => {
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const payload = %(payload)s;

  const box = document.querySelector(%(textarea)s);
  if (!box) return { ok: false, why: 'source textarea not found' };
  setValue(box, payload.urls.join('\\n'));

  const fields = %(sub_fields)s;
  payload.sub_ids.forEach((value, i) => {
    const el = document.querySelector(fields[i]);
    if (el) setValue(el, value);
  });

  return { ok: true, filled: payload.urls.length };
})()
"""

_CLICK_TEMPLATE = """
(() => {
  const wanted = new RegExp(%(label)s, 'i');
  const button = [...document.querySelectorAll('button')]
    .find(b => wanted.test(b.innerText || ''));
  if (!button) return { ok: false, why: 'submit button not found' };
  if (button.disabled) return { ok: false, why: 'submit button is disabled' };
  button.click();
  return { ok: true };
})()
"""

# The result lands in a disabled textarea, so read .value, not .innerText.
# The result box is only trusted when it holds something DIFFERENT from
# what was in it before this submission. Waiting for "not empty" was
# enough only because every pass used to reload the page and wipe it; the
# moment that reload was skipped, the previous customer's link was still
# sitting there and got read back as this customer's answer.
# One look per call, no waiting inside the page -- see _pause for why page
# timers cannot be trusted. _read_result polls this from Python.
_READ_ONCE_TEMPLATE = """
(() => {
  const previous = %(previous)s;
  const el = document.querySelector(%(result)s);
  const text = (el && el.value) ? el.value.trim() : '';
  if (text && /shopee/i.test(text) && text !== previous) {
    return { ok: true, links: text.split(/\\r?\\n/).map(s => s.trim()).filter(Boolean) };
  }
  const errEl = document.querySelector('.ant-form-item-explain-error, .ant-message-error, .ant-notification-notice-error, .ant-alert-error');
  const err = errEl && errEl.innerText ? errEl.innerText.trim() : '';
  return { ok: false, error: err };
})()
"""


def _read_result(bridge: Bridge, previous: str, timeout_ms: int) -> dict:
    """Poll the result box until a new link shows, Shopee shows an error,
    or time runs out. Same answers as the old in-page loop."""
    code = _READ_ONCE_TEMPLATE % {"result": json.dumps(RESULT_FIELD),
                                  "previous": json.dumps(previous)}
    start = time.monotonic()
    deadline = start + timeout_ms / 1000
    while True:
        seen = _js(bridge, code, timeout=20)
        if seen.get("ok"):
            return seen
        # An error line can linger from the previous submission for a moment.
        if seen.get("error") and time.monotonic() - start > 2:
            return {"ok": False, "why": "shopee_error: " + seen["error"]}
        if time.monotonic() > deadline:
            return {"ok": False, "why": "timed out waiting for a result"}
        time.sleep(0.3)


_CLEAR_TEMPLATE = """
(() => {
  const setValue = (el, value) => {
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  for (const sel of %(all_fields)s) {
    const el = document.querySelector(sel);
    if (el) setValue(el, '');
  }
  return { ok: true };
})()
"""


STEPS = {1: "open the Custom Link page", 2: "fill the form",
         3: "press the submit button", 4: "read the link back"}


class LinkStepError(RuntimeError):
    """A failed step, with what the page looked like when it failed.

    "could not fill the form: source textarea not found" says nothing
    about why. The page state beside it usually does: a login page, a
    verification page, a form whose fields were renamed, a button whose
    label changed. Read one of these lines before touching any code.
    """

    def __init__(self, step: int, why: str, state: str, hint: str):
        self.step, self.why, self.state, self.hint = step, why, state, hint
        low = why.lower()
        # The page's fault, not the link's: it never loaded, lost a field,
        # or stopped answering. Such a failure must not count against the
        # customer's request -- three of them and the customer is told their
        # link failed when nothing was wrong with it (28/9/2026: a tab idle
        # for three hours was still rendering when the first link came in).
        self.page_level = (
            step == 1
            or "not found" in low
            or any(m in low for m in ("no result for", "job_timeout", "execute_script_timeout"))
        )
        super().__init__(
            f"[step {step}/4: {STEPS[step]}] {why} || page: {state}"
            + (f" || likely: {hint}" if hint else ""))


_PAGE_STATE_TEMPLATE = """
(() => {
  const has = sel => !!document.querySelector(sel);
  const subs = %(sub_fields)s.filter(has).length;
  const buttons = [...document.querySelectorAll('button')]
    .map(b => (b.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 30))
    .filter(Boolean).slice(0, 8);
  const errors = [...document.querySelectorAll(
      '.ant-form-item-explain-error, .ant-message-error, .ant-notification-notice-error, .ant-alert-error')]
    .map(e => (e.innerText || '').trim().slice(0, 80)).filter(Boolean).slice(0, 3);
  return {
    href: location.href,
    title: (document.title || '').slice(0, 60),
    password_box: has('input[type=password]'),
    textarea: has(%(textarea)s),
    result: has(%(result)s),
    subs: subs,
    buttons: buttons,
    errors: errors,
  };
})()
"""


def page_state(bridge: Bridge) -> dict:
    """What the tab shows right now. Never raises: it runs on the way out
    of a failure, and must not hide the failure behind its own."""
    try:
        return _js(bridge, _PAGE_STATE_TEMPLATE % {
            "sub_fields": json.dumps(SUB_ID_FIELDS),
            "textarea": json.dumps(SOURCE_TEXTAREA),
            "result": json.dumps(RESULT_FIELD),
        }, timeout=20)
    except Exception as exc:  # noqa: BLE001 - diagnostics only
        return {"unavailable": str(exc)[:120]}


def _describe(state: dict) -> str:
    if "unavailable" in state:
        return f"unavailable ({state['unavailable']})"
    found = lambda ok: "found" if ok else "MISSING"  # noqa: E731
    return (f"url={state.get('href', '?')} title={state.get('title', '')!r} "
            f"textarea={found(state.get('textarea'))} result_box={found(state.get('result'))} "
            f"sub_id_fields={state.get('subs', 0)}/{len(SUB_ID_FIELDS)} "
            f"buttons={state.get('buttons', [])}"
            + (f" page_errors={state['errors']}" if state.get("errors") else ""))


def _hint(step: int, why: str, state: dict) -> str:
    href = str(state.get("href") or "")
    low = why.lower()
    if "unavailable" in state or "no result for" in low or "job_timeout" in low:
        return ("the extension or the tab stopped answering: reload the Shopee Affiliate "
                "tab in Chrome [4]; if that fails restart Chrome [4] and backend [1]")
    if any(m in href for m in VERIFICATION_MARKERS):
        return "Shopee wants a verification check: drag the slider in Chrome [4]"
    if state.get("password_box") or any(m in href for m in ("/login", "/signin", "passport", "/account")):
        return "the tab is on a login page: log in to affiliate.shopee.vn in Chrome [4]"
    if CUSTOM_LINK_URL.rstrip("/") not in href:
        return f"the tab is not on {CUSTOM_LINK_URL}: open it in Chrome [4]"
    if step == 2 and not state.get("textarea"):
        return ("on the right page but the link box is gone: Shopee probably changed the page; "
                "update SOURCE_TEXTAREA in shopee/page_selectors.py")
    if step == 2 and state.get("subs", 0) < len(SUB_ID_FIELDS):
        return ("some sub_id fields are missing: Shopee changed the form; "
                "update SUB_ID_FIELDS in shopee/page_selectors.py")
    if step == 3 and "not found" in low:
        return (f"no button matches {SUBMIT_BUTTON_TEXT!r} (buttons on the page are listed above): "
                "update SUBMIT_BUTTON_TEXT in shopee/page_selectors.py")
    if step == 3 and "disabled" in low:
        return "the form refused the input (see page_errors); a product link may be invalid"
    if step == 4 and "shopee_error" in low:
        return "Shopee itself refused (message above): often a product not in the affiliate program"
    if step == 4 and not state.get("result"):
        return "the result box is gone: update RESULT_FIELD in shopee/page_selectors.py"
    if step == 4:
        return "Shopee answered nothing in time: slow page or rate limiting; it retries by itself"
    return ""


def _fail(bridge: Bridge, step: int, why: str) -> LinkStepError:
    state = page_state(bridge)
    hint = _hint(step, why, state)
    href = str(state.get("href") or "")
    low = why.lower()

    # Trigger urgent alerts to Telegram Dev Group
    try:
        from ..core import telegram_alerts
        if any(m in href for m in VERIFICATION_MARKERS) or "verification check" in low:
            telegram_alerts.notify_shopee_captcha(hint=hint, current_url=href)
        elif state.get("password_box") or any(m in href for m in ("/login", "/signin", "passport", "/account")):
            telegram_alerts.notify_shopee_session_expired(hint=hint, current_url=href)
        elif "unavailable" in state or "no result for" in low or "job_timeout" in low:
            telegram_alerts.notify_shopee_bridge_disconnected()
    except Exception:
        pass

    return LinkStepError(step, why, _describe(state), hint)


def _js(bridge: Bridge, code: str, timeout: float = 60) -> dict:
    try:
        value = bridge.submit(
            Job(connector=CONNECTOR, action="execute_script", params={"code": code}),
            timeout=timeout,
        )
        return (value or {}).get("result") or {}
    except RuntimeError as exc:
        if "navigated or closed" in str(exc).lower():
            time.sleep(1.5)
            value = bridge.submit(
                Job(connector=CONNECTOR, action="execute_script", params={"code": code}),
                timeout=timeout,
            )
            return (value or {}).get("result") or {}
        raise


def _pause(bridge: Bridge, ms: int) -> None:
    """Wait here, not in the page.

    A page timer in a tab Chrome considers hidden is throttled to once a
    minute (intensive wake-up throttling): a 3.5 second pause inside the
    page took over a minute, every step timed out, and every link failed.
    That is what happened on the Mac, where Chrome ran without the
    anti-throttling flags start-browser.ps1 passes. Sleeping in Python
    does not depend on how Chrome was started. `bridge` stays in the
    signature so callers need not change.
    """
    time.sleep(ms / 1000)


# Shopee parks a session it distrusts on one of these instead of the page
# that was asked for. It is a whole-session state, not a problem with any
# one product, and only a human dragging the slider clears it.
VERIFICATION_MARKERS = ("/verify/traffic", "/verify/captcha", "/verify/")


def blocked_by_verification(bridge: Bridge) -> str:
    """Return the verification URL the tab is stuck on, or ''.

    Checked before every batch. Without it a captcha looks like five
    products that cannot be converted: the attempt counter burns through
    and five customers are told their link failed, when nothing was wrong
    with their links at all.
    """
    found = _js(bridge, "({href: location.href})")
    href = str(found.get("href") or "")
    return href if any(m in href for m in VERIFICATION_MARKERS) else ""


def open_page(bridge: Bridge, settle_ms: int = 3500) -> None:
    """Make sure the tab is on the Custom Link page and ready to drive.

    Reloading a page that is already open costs about three and a half
    seconds of every pass and gains nothing: the form is still there, and
    the previous submission left it in a state the next one clears anyway.
    Skipping it is most of the difference between a customer waiting eight
    seconds and waiting four.
    """
    try:
        _open_page(bridge, settle_ms)
    except LinkStepError:
        raise
    except RuntimeError as exc:
        raise _fail(bridge, 1, str(exc)) from exc


def _open_page(bridge: Bridge, settle_ms: int) -> None:
    here = _js(bridge, "({href: location.href})").get("href") or ""
    already_there = CUSTOM_LINK_URL.rstrip("/") in here

    if not already_there:
        _navigate(bridge)

    # The right URL is not a ready page. After hours idle, Chrome can still
    # be rendering Shopee's app when the next link arrives: the URL matches,
    # the form is not there yet. Wait for the form itself; if it never
    # comes, reload once and wait again.
    for attempt in (1, 2):
        stuck = blocked_by_verification(bridge)
        if stuck:
            raise _fail(bridge, 1,
                        "Shopee is asking this session to pass a verification check. "
                        "Open the pinned tab and drag the slider, then it resumes by "
                        f"itself. ({stuck[:90]})")
        if _wait_for_form(bridge, FORM_WAIT_SECONDS[attempt - 1]):
            return
        if attempt == 1:
            _navigate(bridge)
    raise _fail(bridge, 1, "the link form never appeared, even after a reload")


# How long to wait for the form: first as the page stands, then after a reload.
FORM_WAIT_SECONDS = (12, 20)

_FORM_READY_TEMPLATE = """
(() => {
  const wanted = new RegExp(%(label)s, 'i');
  const box = !!document.querySelector(%(textarea)s);
  const button = [...document.querySelectorAll('button')].some(b => wanted.test(b.innerText || ''));
  return { ready: box && button };
})()
"""


def _navigate(bridge: Bridge) -> None:
    bridge.submit(
        Job(connector=CONNECTOR, action="navigate", params={"url": CUSTOM_LINK_URL}),
        timeout=90,
    )


def _wait_for_form(bridge: Bridge, seconds: float) -> bool:
    """True once the link box and the submit button are both on the page."""
    code = _FORM_READY_TEMPLATE % {"label": json.dumps(SUBMIT_BUTTON_TEXT),
                                   "textarea": json.dumps(SOURCE_TEXTAREA)}
    deadline = time.monotonic() + seconds
    while True:
        try:
            if _js(bridge, code, timeout=20).get("ready"):
                return True
        except RuntimeError:
            pass   # a page mid-load can refuse a script; keep looking
        if time.monotonic() > deadline:
            return False
        time.sleep(0.5)


def convert_chunk(
    bridge: Bridge, urls: list[str], sub_ids: list[str], result_timeout_ms: int = 20000
) -> list[str]:
    """Submit up to MAX_LINKS_PER_SUBMIT urls sharing one set of sub_ids."""
    if not urls:
        return []
    if len(urls) > MAX_LINKS_PER_SUBMIT:
        raise ValueError(
            f"the page accepts at most {MAX_LINKS_PER_SUBMIT} urls per submission,"
            f" got {len(urls)}"
        )
    for value in sub_ids:
        assert_valid_sub_id(value)

    at = [2]   # the step running, for a bridge failure in the middle of one
    try:
        return _convert(bridge, urls, sub_ids, result_timeout_ms, at)
    except LinkStepError:
        raise
    except RuntimeError as exc:
        # A bridge failure (timeout, script error) rather than a step that
        # answered "no": label it with the step it happened in.
        raise _fail(bridge, at[0], str(exc)) from exc


def _convert(bridge: Bridge, urls: list[str], sub_ids: list[str],
             result_timeout_ms: int, at: list[int]) -> list[str]:
    # Whatever is in the result box belongs to the previous submission.
    # Read it first so the new answer can be told apart from it, then
    # clear it along with the inputs.
    previous = _js(
        bridge,
        "({v: (document.querySelector(%s)||{}).value || ''})"
        % json.dumps(RESULT_FIELD),
    ).get("v", "").strip()

    all_fields = [SOURCE_TEXTAREA, RESULT_FIELD, *SUB_ID_FIELDS]
    _js(bridge, _CLEAR_TEMPLATE % {"all_fields": json.dumps(all_fields)})

    filled = _js(
        bridge,
        _FILL_TEMPLATE
        % {
            "payload": json.dumps({"urls": urls, "sub_ids": sub_ids}),
            "textarea": json.dumps(SOURCE_TEXTAREA),
            "sub_fields": json.dumps(SUB_ID_FIELDS),
        },
    )
    if not filled.get("ok"):
        raise _fail(bridge, 2, f"could not fill the form: {filled.get('why')}")

    at[0] = 3

    _pause(bridge, 500)

    clicked = _js(bridge, _CLICK_TEMPLATE % {"label": json.dumps(SUBMIT_BUTTON_TEXT)})
    if not clicked.get("ok"):
        raise _fail(bridge, 3, f"could not submit: {clicked.get('why')}")

    at[0] = 4

    read = _read_result(bridge, previous, result_timeout_ms)
    if not read.get("ok"):
        raise _fail(bridge, 4, f"no link came back: {read.get('why')}")

    links = read.get("links") or []
    if len(links) != len(urls):
        raise RuntimeError(
            f"submitted {len(urls)} url(s) but got {len(links)} link(s) back;"
            " refusing to guess which belongs to which"
        )
    return links


def generate(bridge: Bridge, jobs: list[dict]) -> list[dict]:
    """Turn a batch from queue_batch.collect() into results.

    Each job needs request_id, source_url and sub_ids. Grouping by customer
    is what keeps attribution intact, so it is done here rather than left to
    the caller to remember.
    """
    if not jobs:
        return []

    by_customer: dict[str, list[dict]] = defaultdict(list)
    for job in jobs:
        by_customer[job["sub_ids"][0]].append(job)

    open_page(bridge)
    results: list[dict] = []

    for customer_id, group in by_customer.items():
        for start in range(0, len(group), LINKS_PER_SUBMIT):
            chunk = group[start : start + LINKS_PER_SUBMIT]

            # sub_id1 is the customer, shared by the chunk. sub_id2 would be
            # the request, but it cannot vary within a submission, so it is
            # only sent when the chunk is a single request.
            sub_ids = [customer_id]
            if len(chunk) == 1:
                sub_ids.append(chunk[0]["sub_ids"][1])

            try:
                links = convert_chunk(
                    bridge, [job["source_url"] for job in chunk], sub_ids
                )
            except LinkStepError as exc:
                if exc.page_level:
                    # The page broke, not these links. Keep what this pass
                    # already made; hand the rest back to be retried
                    # without counting an attempt against anyone.
                    done = {r["request_id"] for r in results}
                    results.extend(
                        {"request_id": job["request_id"], "retry": True, "error": str(exc)}
                        for job in jobs if job["request_id"] not in done)
                    return results
                for job in chunk:
                    results.append(
                        {"request_id": job["request_id"], "error": str(exc)}
                    )
                continue
            except (RuntimeError, ValueError) as exc:
                for job in chunk:
                    results.append(
                        {"request_id": job["request_id"], "error": str(exc)}
                    )
                continue

            for job, link in zip(chunk, links):
                results.append(
                    {"request_id": job["request_id"], "affiliate_url": link}
                )

            # A pause between submissions. One customer sending five
            # links becomes five clicks; spacing them keeps that looking
            # like a person rather than a script.
            if start + LINKS_PER_SUBMIT < len(group):
                _pause(bridge, 1200)

    return results
