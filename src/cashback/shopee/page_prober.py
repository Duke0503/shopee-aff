"""Discover the shape of a page through the extension.

Selectors are not guessed here. This drives the operator's own logged-in
tab, dumps every form control and button it finds, and prints the result so
a real script can be written against what is actually on the page.

Run it again whenever the site changes and the script stops working.
"""

from __future__ import annotations

import json

from ..shopee.browser_bridge import Bridge, Job

# Runs inside the page. Returns a plain object, so keep it to values that
# survive JSON: no DOM nodes, no functions.
DISCOVERY_SCRIPT = r"""
(() => {
  const MAX_TEXT = 60;
  const MAX_CLASS = 120;

  const trim = (s, n) => {
    if (!s) return '';
    s = String(s).replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n) + '...' : s;
  };

  const visible = el => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 &&
           st.visibility !== 'hidden' && st.display !== 'none';
  };

  // A selector stable enough to reuse. Prefer id, then name, then a
  // data-* attribute, then aria-label, and fall back to nth-of-type.
  const selectorFor = el => {
    if (el.id) return '#' + CSS.escape(el.id);
    if (el.name) return `${el.tagName.toLowerCase()}[name="${el.name}"]`;
    for (const a of el.attributes) {
      if (a.name.startsWith('data-') && a.value) {
        return `${el.tagName.toLowerCase()}[${a.name}="${a.value}"]`;
      }
    }
    const label = el.getAttribute('aria-label');
    if (label) return `${el.tagName.toLowerCase()}[aria-label="${label}"]`;
    const siblings = [...(el.parentElement?.children ?? [])]
      .filter(s => s.tagName === el.tagName);
    const idx = siblings.indexOf(el) + 1;
    const parent = el.parentElement;
    const parentPart = parent?.className && typeof parent.className === 'string'
      ? '.' + parent.className.trim().split(/\s+/).slice(0, 2).map(CSS.escape).join('.')
      : (parent?.tagName?.toLowerCase() ?? '');
    return `${parentPart} > ${el.tagName.toLowerCase()}:nth-of-type(${idx})`;
  };

  const describe = el => ({
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute('type') || '',
    id: el.id || '',
    name: el.getAttribute('name') || '',
    placeholder: el.getAttribute('placeholder') || '',
    aria_label: el.getAttribute('aria-label') || '',
    text: trim(el.innerText || el.value || '', MAX_TEXT),
    cls: trim(typeof el.className === 'string' ? el.className : '', MAX_CLASS),
    disabled: !!el.disabled,
    visible: visible(el),
    selector: selectorFor(el),
  });

  const inputs = [...document.querySelectorAll('input, textarea, select')]
    .map(describe);

  const buttons = [...document.querySelectorAll(
    'button, [role="button"], a.btn, input[type="submit"]'
  )].map(describe);

  // Anything whose text hints at the convert action, whatever it is built from.
  const wordRe = /chuy.n .+i|convert|t.o link|generate|submit/i;
  const actionish = [...document.querySelectorAll('button, a, div, span')]
    .filter(el => wordRe.test(el.innerText || '') &&
                  (el.innerText || '').length < 40 && visible(el))
    .slice(0, 15)
    .map(describe);

  // Tabs, so we know whether the single-link or Excel pane is showing.
  const tabs = [...document.querySelectorAll(
    '[role="tab"], .tab, [class*="tab"]'
  )].filter(visible).slice(0, 15).map(el => ({
    text: trim(el.innerText, MAX_TEXT),
    cls: trim(typeof el.className === 'string' ? el.className : '', MAX_CLASS),
    selector: selectorFor(el),
  }));

  return {
    url: location.href,
    title: document.title,
    inputs, buttons, actionish, tabs,
    counts: {
      inputs: inputs.length,
      buttons: buttons.length,
      iframes: document.querySelectorAll('iframe').length,
    },
  };
})()
"""


def _row(item: dict) -> str:
    bits = [f"<{item['tag']}"]
    if item.get("type"):
        bits.append(f"type={item['type']}")
    if item.get("id"):
        bits.append(f"id={item['id']}")
    if item.get("name"):
        bits.append(f"name={item['name']}")
    bits.append(">")
    head = " ".join(bits)

    extras = []
    if item.get("placeholder"):
        extras.append(f"placeholder={item['placeholder']!r}")
    if item.get("aria_label"):
        extras.append(f"aria-label={item['aria_label']!r}")
    if item.get("text"):
        extras.append(f"text={item['text']!r}")
    if not item.get("visible"):
        extras.append("HIDDEN")
    if item.get("disabled"):
        extras.append("DISABLED")

    line = f"    {head}"
    if extras:
        line += "  " + " ".join(extras)
    line += f"\n      selector: {item['selector']}"
    if item.get("cls"):
        line += f"\n      class:    {item['cls']}"
    return line


def report(found: dict) -> str:
    out = [
        f"URL   : {found.get('url', '?')}",
        f"Title : {found.get('title', '?')}",
        f"Counts: {json.dumps(found.get('counts', {}))}",
    ]
    if found.get("counts", {}).get("iframes"):
        out.append(
            "  NOTE: the page has iframes. If the form is inside one, the"
            " script must target that frame, not the top document."
        )

    for label, key in (
        ("TABS", "tabs"),
        ("INPUTS", "inputs"),
        ("BUTTONS", "buttons"),
        ("LOOKS LIKE THE CONVERT ACTION", "actionish"),
    ):
        items = found.get(key) or []
        out.append(f"\n{label}  ({len(items)})")
        if not items:
            out.append("    none found")
            continue
        for item in items:
            out.append(_row(item) if "tag" in item else
                       f"    {item.get('text','')!r}\n"
                       f"      selector: {item.get('selector','')}")
    return "\n".join(out)


def run(bridge: Bridge, url: str, wait_ms: int = 3000) -> dict:
    """Navigate the pinned tab and dump what is on the page."""
    bridge.submit(
        Job(connector="shopee_affiliate", action="navigate", params={"url": url}),
        timeout=60,
    )
    bridge.submit(
        Job(
            connector="shopee_affiliate",
            action="execute_script",
            params={"code": f"new Promise(r => setTimeout(r, {wait_ms}))"},
        ),
        timeout=60,
    )
    value = bridge.submit(
        Job(
            connector="shopee_affiliate",
            action="execute_script",
            params={"code": DISCOVERY_SCRIPT},
        ),
        timeout=60,
    )
    return (value or {}).get("result") or {}
