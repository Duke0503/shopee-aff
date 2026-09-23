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
# Poll rather than sleeping a fixed time: the page is sometimes instant and
# sometimes takes several seconds.
# The result box is only trusted when it holds something DIFFERENT from
# what was in it before this submission. Waiting for "not empty" was
# enough only because every pass used to reload the page and wipe it; the
# moment that reload was skipped, the previous customer's link was still
# sitting there and got read back as this customer's answer.
_READ_TEMPLATE = """
(() => {
  const deadline = Date.now() + %(timeout_ms)d;
  const start = Date.now();
  const previous = %(previous)s;
  const read = () => {
    const el = document.querySelector(%(result)s);
    const text = (el && el.value) ? el.value.trim() : '';
    if (!text || !/shopee/i.test(text)) return '';
    if (text === previous) return '';        // still the last answer
    return text;
  };
  const checkError = () => {
    const errEl = document.querySelector('.ant-form-item-explain-error, .ant-message-error, .ant-notification-notice-error, .ant-alert-error');
    if (errEl && errEl.innerText && errEl.innerText.trim()) {
      return errEl.innerText.trim();
    }
    return '';
  };
  return new Promise(resolve => {
    const tick = () => {
      const found = read();
      if (found) return resolve({ ok: true, links: found.split(/\\r?\\n/)
        .map(s => s.trim()).filter(Boolean) });
      if (Date.now() - start > 2000) {
        const errMsg = checkError();
        if (errMsg) return resolve({ ok: false, why: 'shopee_error: ' + errMsg });
      }
      if (Date.now() > deadline) return resolve({ ok: false, why: 'timed out waiting for a result' });
      setTimeout(tick, 300);
    };
    tick();
  });
})()
"""

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
    _js(bridge, f"new Promise(r => setTimeout(r, {ms}))", timeout=ms / 1000 + 20)


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
    here = _js(bridge, "({href: location.href})").get("href") or ""
    already_there = CUSTOM_LINK_URL.rstrip("/") in here

    if not already_there:
        bridge.submit(
            Job(connector=CONNECTOR, action="navigate",
                params={"url": CUSTOM_LINK_URL}),
            timeout=90,
        )
        _pause(bridge, settle_ms)
    else:
        # The form is live already; this is only breathing room for any
        # in-flight render from the last pass.
        _pause(bridge, 300)

    stuck = blocked_by_verification(bridge)
    if stuck:
        raise RuntimeError(
            "Shopee is asking this session to pass a verification check. "
            "Open the pinned tab and drag the slider, then it resumes by "
            f"itself. ({stuck[:90]})"
        )


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
        raise RuntimeError(f"could not fill the form: {filled.get('why')}")

    _pause(bridge, 500)

    clicked = _js(bridge, _CLICK_TEMPLATE % {"label": json.dumps(SUBMIT_BUTTON_TEXT)})
    if not clicked.get("ok"):
        raise RuntimeError(f"could not submit: {clicked.get('why')}")

    read = _js(
        bridge,
        _READ_TEMPLATE
        % {"result": json.dumps(RESULT_FIELD),
           "previous": json.dumps(previous),
           "timeout_ms": result_timeout_ms},
        timeout=result_timeout_ms / 1000 + 30,
    )
    if not read.get("ok"):
        raise RuntimeError(f"no link came back: {read.get('why')}")

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
