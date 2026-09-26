"""What /s/<code> shows: a product page that sends the buyer on to Shopee.

Everyone who opens one of our links lands here first -- picture, name,
price, the cashback in dong -- and the button takes them on. The button
goes through /s/<code>/go, which records the tap and redirects to the
affiliate link, so we know who actually went to buy.

Where the page is opened decides what the button does:

  - A real browser (Chrome, Safari, a desktop): a plain link to /go.
  - Zalo (or any in-app browser) on Android: the button asks Chrome to
    open /go, because a purchase started inside Zalo's own browser is not
    credited. If Chrome is missing, the intent falls back to /go in place.
  - Zalo on iOS: iOS lets no page leave an in-app browser on its own, so
    the button tries Safari (x-safari-https, iOS 17+) and an overlay
    points at the menu where "open in browser" lives. A small last link
    still buys in place, for someone who cannot get out.
  - A link-preview bot: the same page, whose Open Graph tags give the
    chat its preview card. Bots run no script and are not counted.

A house link (a guest who never gave a customer code) earns the customer
nothing, so the page says so and points at the Zalo group instead of
showing an amount it will never pay.

Every word comes from resources/dashboard.vi.json (open_*).
"""

from __future__ import annotations

import html
import json
import urllib.parse

from ..ledger import share_links

_IN_APP_MARKERS = ("zalo", "fban", "fbav", "fb_iab", "messenger", "instagram",
                   "line/", "micromessenger", "tiktok", "bytedancewebview",
                   "musical_ly", "; wv)")
_BOT_MARKERS = ("bot", "crawler", "spider", "facebookexternalhit", "preview",
                "slurp", "curl", "wget", "python-requests", "headless")

PLATFORM_NAMES = {"shopee": "Shopee", "shopeefood": "ShopeeFood",
                  "tiktok": "TikTok Shop", "lazada": "Lazada"}


def classify(user_agent: str) -> str:
    ua = (user_agent or "").lower()
    if not ua or "mozilla" not in ua or any(m in ua for m in _BOT_MARKERS):
        return share_links.AGENT_BOT
    if any(m in ua for m in _IN_APP_MARKERS):
        return share_links.AGENT_IN_APP
    return share_links.AGENT_BROWSER


def device(user_agent: str) -> str:
    ua = (user_agent or "").lower()
    if any(m in ua for m in ("iphone", "ipad", "ipod")):
        return "ios"
    return "android" if "android" in ua else "other"


def _rate(value) -> str:
    """7.0 -> "7", 2.5 -> "2.5": a rate as a person writes it."""
    try:
        return f"{float(value):g}"
    except (TypeError, ValueError):
        return str(value)


def is_safe_target(url: str) -> bool:
    return bool(url) and url.lower().startswith("https://")


def android_intent(url: str, fallback: str) -> str:
    """Open url in Chrome; if Chrome is missing, go to fallback."""
    parts = urllib.parse.urlsplit(url)
    rest = parts.netloc + parts.path + (f"?{parts.query}" if parts.query else "")
    return (f"intent://{rest}#Intent;scheme={parts.scheme};package=com.android.chrome;"
            f"S.browser_fallback_url={urllib.parse.quote(fallback, safe='')};end")


def buy_href(page_url: str, agent: str, user_agent: str) -> str:
    """Where the buy button goes, given where the page is open."""
    go = f"{page_url}/go"
    if agent != share_links.AGENT_IN_APP:
        return go
    kind = device(user_agent)
    if kind == "android":
        return android_intent(go, go)
    if kind == "ios":
        return "x-safari-" + go
    return go


_STYLE = """
:root { --bg:#f8fafc; --card:#ffffff; --ink:#0f172a; --muted:#64748b; --line:#e2e8f0;
  --brand:#059669; --brand-ink:#ffffff; --brand-soft:#ecfdf5; --brand-deep:#065f46;
  --warn:#b45309; --warn-soft:#fffbeb; --shadow:0 1px 2px rgb(15 23 42 / 4%), 0 8px 24px rgb(15 23 42 / 6%); }
@media (prefers-color-scheme: dark) { :root { --bg:#0b1220; --card:#111827; --ink:#f1f5f9;
  --muted:#94a3b8; --line:#1f2937; --brand:#10b981; --brand-ink:#04120c; --brand-soft:#052e22;
  --brand-deep:#6ee7b7; --warn:#fbbf24; --warn-soft:#2a1f05; --shadow:none; } }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--ink);
  font:15px/1.5 Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width:460px; margin:0 auto; padding:16px 16px 40px; }
.top { display:flex; align-items:center; gap:10px; padding:4px 2px 14px; font-weight:700; }
.top img { width:32px; height:32px; border-radius:8px; }
.top span { font-size:15px; }
.top small { margin-left:auto; color:var(--muted); font-weight:500; }
.card { background:var(--card); border:1px solid var(--line); border-radius:16px;
  box-shadow:var(--shadow); overflow:hidden; }
.shot { display:block; width:100%; aspect-ratio:1/1; object-fit:cover; background:var(--line); }
.body { padding:16px 16px 18px; }
.name { font-size:17px; font-weight:600; line-height:1.4; margin:0 0 6px;
  display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
.price { font-size:20px; font-weight:800; margin:0 0 14px; }
.cash { background:var(--brand-soft); border-radius:12px; padding:14px; margin:0 0 12px; }
.cash .label { color:var(--brand-deep); font-size:13px; font-weight:600; margin:0; }
.cash .amount { color:var(--brand-deep); font-size:28px; font-weight:800; line-height:1.2; margin:2px 0 6px; }
.cash .detail { color:var(--muted); font-size:13px; margin:0; }
.event { border:1px dashed var(--warn); background:var(--warn-soft); color:var(--ink);
  border-radius:12px; padding:10px 12px; font-size:14px; margin:0 0 12px; }
.alert { background:var(--warn-soft); border-radius:12px; padding:12px; font-size:14px; margin:0 0 12px; }
.alert strong { display:block; margin-bottom:2px; }
.btn { display:block; text-align:center; background:var(--brand); color:var(--brand-ink);
  text-decoration:none; font-weight:700; font-size:16px; padding:15px; border-radius:12px; margin:4px 0 10px; }
.ghost { display:block; width:100%; text-align:center; background:transparent; color:var(--ink);
  border:1px solid var(--line); font:inherit; font-weight:600; padding:12px; border-radius:12px;
  text-decoration:none; margin:0 0 10px; cursor:pointer; }
.stay { display:block; text-align:center; font-size:13px; color:var(--muted); margin-top:4px; }
details { margin-top:14px; border-top:1px solid var(--line); padding-top:12px; }
summary { cursor:pointer; font-weight:600; }
details ol { margin:8px 0 0; padding-left:20px; color:var(--muted); font-size:14px; }
details li { margin:4px 0; }
.foot { text-align:center; color:var(--muted); font-size:12px; margin-top:16px; }
#veil { position:fixed; inset:0; background:rgb(2 6 23 / 78%); color:#fff; display:none;
  z-index:10; padding:24px; }
#veil.on { display:block; }
#veil svg { position:absolute; top:10px; right:18px; width:90px; height:90px; }
#veil .box { position:absolute; top:110px; left:24px; right:24px; max-width:420px; margin:0 auto;
  font-size:16px; line-height:1.5; }
#veil button { margin-top:16px; background:#fff; color:#0f172a; border:0; font:inherit;
  font-weight:700; padding:12px 18px; border-radius:12px; }
"""


def render(words: dict, *, page_url: str, target: str, platform: str,
           agent: str, user_agent: str, product: dict, house: bool,
           offer: dict | None, zalo_url: str = "") -> str:
    """The product page for /s/<code>."""
    name = PLATFORM_NAMES.get(platform or "shopee", "Shopee")

    def fill(key: str, **extra) -> str:
        text = words.get(key, "").replace("{platform}", name)
        for k, v in extra.items():
            text = text.replace("{" + k + "}", str(v))
        return html.escape(text)

    kind = device(user_agent)
    in_app = agent == share_links.AGENT_IN_APP
    title_text = product.get("name") or words.get("open_title", "").replace("{platform}", name)
    title = html.escape(title_text)
    image = product.get("image_url") or ""
    image_ok = is_safe_target(image)

    parts: list[str] = []
    if image_ok:
        parts.append(f'<img class="shot" src="{html.escape(image)}" alt="" referrerpolicy="no-referrer">')
    parts.append('<div class="body">')
    parts.append(f'<h1 class="name">{title}</h1>')
    if product.get("price_formatted"):
        parts.append(f'<p class="price">{html.escape(product["price_formatted"])}</p>')

    if house:
        parts.append(f'<div class="alert"><strong>{fill("open_house_title")}</strong>'
                     f'{fill("open_house_body")}</div>')
        if zalo_url and is_safe_target(zalo_url):
            parts.append(f'<a class="btn" href="{html.escape(zalo_url)}">{fill("open_house_cta")}</a>')
    else:
        detail = []
        if product.get("shopee_rate"):
            detail.append(fill("open_rate_line", source=name, rate=_rate(product["shopee_rate"]),
                               amount=product.get("shopee_part_formatted", "")))
        if product.get("seller_rate"):
            detail.append(fill("open_rate_line", source=words.get("open_shop", ""),
                               rate=_rate(product["seller_rate"]),
                               amount=product.get("seller_part_formatted", "")))
        if product.get("is_capped"):
            detail.append(fill("open_capped"))
        if product.get("cashback"):
            parts.append(
                '<div class="cash">'
                f'<p class="label">{fill("open_cashback_label", rate=product.get("rate_percent", ""))}</p>'
                f'<p class="amount">{html.escape(product.get("cashback_formatted", ""))}</p>'
                + (f'<p class="detail">{" &middot; ".join(detail)}</p>' if detail else "")
                + f'<p class="detail">{fill("open_cashback_when")}</p></div>')
        else:
            parts.append(f'<div class="cash"><p class="label">{fill("open_cashback_unknown")}</p>'
                         f'<p class="detail">{fill("open_cashback_when")}</p></div>')
        if offer:
            parts.append(f'<p class="event">{fill("open_campaign", name=offer["name"], bonus=offer["bonus_formatted"], left=offer["left"], slots=offer["slots"])}</p>')

    if in_app:
        parts.append(f'<div class="alert"><strong>{fill("open_in_app_title")}</strong>'
                     f'{fill("open_in_app_body_android" if kind == "android" else "open_in_app_body_ios")}</div>')

    button_key = "open_buy" if not in_app else ("open_buy_android" if kind == "android" else "open_buy_ios")
    button_class = "ghost" if house else "btn"
    parts.append(f'<a class="{button_class}" href="{html.escape(buy_href(page_url, agent, user_agent))}" '
                 f'rel="nofollow">{fill(button_key)}</a>')
    parts.append(f'<button class="ghost" id="copy" type="button">{fill("open_copy")}</button>')
    if in_app:
        parts.append(f'<a class="stay" href="{html.escape(page_url)}/go" rel="nofollow">{fill("open_stay")}</a>')
    parts.append(f'<details><summary>{fill("open_tips_title")}</summary><ol>'
                 + "".join(f"<li>{fill(k)}</li>" for k in
                           ("open_tip_1", "open_tip_2", "open_tip_3", "open_tip_4"))
                 + "</ol></details>")
    parts.append("</div>")

    veil = ""
    if in_app and kind == "ios":
        veil = ('<div id="veil" class="on" role="dialog"><svg viewBox="0 0 100 100" fill="none" aria-hidden="true">'
                '<path d="M10 90 Q 20 30 80 14" stroke="#fde68a" stroke-width="7" stroke-linecap="round"/>'
                '<path d="M58 8 L 82 13 L 72 36" stroke="#fde68a" stroke-width="7" stroke-linecap="round" '
                'stroke-linejoin="round"/></svg>'
                f'<div class="box">{fill("open_veil_ios")}<br><button type="button" id="veil-close">'
                f'{fill("open_veil_close")}</button></div></div>')

    script = {"share": page_url, "copied": words.get("open_copied", "")}
    return f"""<!doctype html>
<html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>{title}</title>
<meta property="og:title" content="{title}">
<meta property="og:description" content="{fill("open_preview_description")}">
<meta property="og:type" content="website">
{f'<meta property="og:image" content="{html.escape(image)}">' if image_ok else ""}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>{_STYLE}</style></head>
<body><main>
<div class="top"><img src="/logo-mark.webp" alt=""><span>{fill("open_brand")}</span><small>{html.escape(name)}</small></div>
<div class="card">{"".join(parts)}</div>
<p class="foot">{fill("open_footer")}</p>
</main>{veil}
<script>
(function () {{
  var s = {json.dumps(script, ensure_ascii=False)};
  var btn = document.getElementById("copy");
  btn.addEventListener("click", function () {{
    function done() {{ btn.textContent = s.copied; }}
    if (navigator.clipboard && navigator.clipboard.writeText) {{
      navigator.clipboard.writeText(s.share).then(done, function () {{ window.prompt("", s.share); }});
    }} else {{ window.prompt("", s.share); }}
  }});
  var close = document.getElementById("veil-close");
  if (close) close.addEventListener("click", function () {{
    document.getElementById("veil").classList.remove("on");
  }});
}})();
</script>
</body></html>"""


def render_not_found(words: dict) -> str:
    fill = lambda key: html.escape(words.get(key, ""))  # noqa: E731
    return f"""<!doctype html>
<html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>{fill("open_not_found_title")}</title>
<style>body{{margin:0;font:16px/1.5 Inter,system-ui,sans-serif;background:#f8fafc;color:#0f172a}}
@media (prefers-color-scheme: dark){{body{{background:#0b1220;color:#f1f5f9}}}}
main{{max-width:440px;margin:0 auto;padding:40px 16px}}h1{{font-size:20px}}</style></head>
<body><main><h1>{fill("open_not_found_title")}</h1><p>{fill("open_not_found_body")}</p></main></body></html>"""
