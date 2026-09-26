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
    the button tries Safari (x-safari-https, iOS 17+) and a small hint in
    the corner points at the menu where "open in browser" lives -- small,
    so it never covers the button. A last link still buys in place, for
    someone who cannot get out.
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
:root { --bg:#f1f5f9; --card:#ffffff; --ink:#0f172a; --muted:#64748b; --line:#e2e8f0;
  --brand:#059669; --brand-hover:#047857; --brand-ink:#ffffff; --brand-soft:#ecfdf5; --brand-deep:#065f46;
  --warn:#b45309; --warn-soft:#fffbeb; --shadow:0 1px 2px rgb(15 23 42 / 4%), 0 12px 32px rgb(15 23 42 / 8%); }
@media (prefers-color-scheme: dark) { :root { --bg:#0b1220; --card:#111827; --ink:#f1f5f9;
  --muted:#94a3b8; --line:#1f2937; --brand:#10b981; --brand-hover:#34d399; --brand-ink:#04120c;
  --brand-soft:#052e22; --brand-deep:#6ee7b7; --warn:#fbbf24; --warn-soft:#2a1f05; --shadow:none; } }
* { box-sizing:border-box; }
html, body { margin:0; }
body { background:var(--bg); color:var(--ink);
  font:15px/1.5 Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.page { max-width:480px; margin:0 auto; padding:12px 16px 32px; }
.top { display:flex; align-items:center; gap:10px; padding:2px 2px 12px; }
.top img { width:30px; height:30px; border-radius:8px; }
.top b { font-size:15px; }
.chip { margin-left:auto; font-size:12px; font-weight:600; color:var(--muted);
  border:1px solid var(--line); border-radius:999px; padding:3px 10px; background:var(--card); }
.card { background:var(--card); border:1px solid var(--line); border-radius:18px; box-shadow:var(--shadow); }
.media { display:none; }
.info { padding:16px; }
.head { display:flex; gap:12px; align-items:flex-start; margin-bottom:14px; }
.thumb { flex:0 0 84px; width:84px; height:84px; border-radius:12px; object-fit:cover;
  background:var(--line); border:1px solid var(--line); }
.name { font-size:15px; font-weight:600; line-height:1.4; margin:0 0 4px;
  display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
.price { font-size:17px; font-weight:800; margin:0; }
.cash { background:var(--brand-soft); border-radius:14px; padding:12px 14px; margin:0 0 12px;
  display:flex; align-items:baseline; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.cash .label { color:var(--brand-deep); font-size:13px; font-weight:600; margin:0; }
.cash .amount { color:var(--brand-deep); font-size:26px; font-weight:800; line-height:1.15; margin:0; }
.cash .when { flex-basis:100%; color:var(--muted); font-size:12px; margin:0; }
.cash.unknown .label { font-weight:500; }
.alert { background:var(--warn-soft); border-radius:14px; padding:12px 14px; font-size:14px; margin:0 0 12px; }
.alert strong { display:block; margin-bottom:2px; }
.cta { position:sticky; bottom:0; z-index:2; margin:0 -16px; padding:8px 16px calc(10px + env(safe-area-inset-bottom));
  background:linear-gradient(to bottom, transparent, var(--card) 28%); }
.btn { display:flex; align-items:center; justify-content:center; gap:8px; min-height:52px;
  background:var(--brand); color:var(--brand-ink); text-decoration:none; font-weight:700;
  font-size:16px; padding:12px 16px; border-radius:14px; box-shadow:0 6px 16px rgb(5 150 105 / 25%); }
.btn:hover { background:var(--brand-hover); }
.btn.secondary { background:transparent; color:var(--ink); border:1px solid var(--line); box-shadow:none; }
.event { display:flex; gap:8px; align-items:flex-start; border:1px dashed var(--warn);
  background:var(--warn-soft); border-radius:14px; padding:10px 12px; font-size:13.5px; margin:4px 0 12px; }
.ghost { display:block; width:100%; text-align:center; background:transparent; color:var(--ink);
  border:1px solid var(--line); font:inherit; font-weight:600; padding:11px; border-radius:12px;
  cursor:pointer; margin:0 0 8px; }
.stay { display:block; text-align:center; font-size:12.5px; color:var(--muted); margin:2px 0 4px; }
details { border-top:1px solid var(--line); padding:12px 0 0; margin-top:12px; }
summary { cursor:pointer; font-weight:600; font-size:14px; }
details ul, details ol { margin:8px 0 0; padding-left:20px; color:var(--muted); font-size:13.5px; }
details li { margin:4px 0; }
.foot { text-align:center; color:var(--muted); font-size:12px; margin-top:14px; }
.hint { position:fixed; top:8px; right:8px; z-index:5; max-width:250px; display:flex; gap:8px;
  align-items:flex-start; background:#0f172a; color:#fff; font-size:13px; line-height:1.4;
  padding:10px 12px 10px 12px; border-radius:12px; box-shadow:0 8px 24px rgb(2 6 23 / 35%); }
.hint::before { content:""; position:absolute; top:-6px; right:18px; border:6px solid transparent;
  border-top:0; border-bottom-color:#0f172a; }
.hint button { background:none; border:0; color:#cbd5e1; font:inherit; font-size:16px; line-height:1;
  padding:0 0 0 4px; cursor:pointer; }
.hint.off { display:none; }
@media (min-width: 760px) {
  body { font-size:16px; }
  .page { max-width:980px; padding:28px 24px 48px; }
  .top { padding-bottom:18px; }
  .card { display:grid; grid-template-columns:minmax(0, 1fr) minmax(0, 1fr); overflow:hidden; }
  .media { display:block; background:var(--line); }
  .media img { display:block; width:100%; height:100%; aspect-ratio:1/1; object-fit:cover; }
  .info { padding:28px 28px 24px; display:flex; flex-direction:column; }
  .thumb { display:none; }
  .head { margin-bottom:18px; }
  .name { font-size:20px; -webkit-line-clamp:4; }
  .price { font-size:24px; margin-top:6px; }
  .cash { padding:16px 18px; }
  .cash .amount { font-size:32px; }
  .cta { position:static; margin:0; padding:0 0 12px; background:none; }
  .btn { min-height:56px; font-size:17px; }
}
"""


def render(words: dict, *, page_url: str, target: str, platform: str,
           agent: str, user_agent: str, product: dict, house: bool,
           offer: dict | None, zalo_url: str = "") -> str:
    """The product page for /s/<code>.

    What must be seen without scrolling, on a phone: what it is, how much
    comes back, and the button. So the picture shrinks to a thumbnail
    there and the button sticks to the bottom edge; on a wide screen the
    picture gets its own column. The campaign sits under the button: a
    reward for acting, not a hurdle before it.
    """
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
    picture = html.escape(image)

    head = ['<div class="head">']
    if image_ok:
        head.append(f'<img class="thumb" src="{picture}" alt="" referrerpolicy="no-referrer">')
    head.append(f'<div><h1 class="name">{title}</h1>')
    if product.get("price_formatted"):
        head.append(f'<p class="price">{html.escape(product["price_formatted"])}</p>')
    head.append("</div></div>")

    info = ["".join(head)]
    if house:
        info.append(f'<div class="alert"><strong>{fill("open_house_title")}</strong>'
                    f'{fill("open_house_body")}</div>')
    elif product.get("cashback"):
        info.append('<div class="cash">'
                    f'<p class="label">{fill("open_cashback_label")}</p>'
                    f'<p class="amount">{html.escape(product.get("cashback_formatted", ""))}</p>'
                    f'<p class="when">{fill("open_cashback_when")}</p></div>')
    else:
        info.append(f'<div class="cash unknown"><p class="label">{fill("open_cashback_unknown")}</p>'
                    f'<p class="when">{fill("open_cashback_when")}</p></div>')

    cta = ['<div class="cta">']
    if house and zalo_url and is_safe_target(zalo_url):
        cta.append(f'<a class="btn" href="{html.escape(zalo_url)}">{fill("open_house_cta")}</a>')
    # One label everywhere; inside Zalo the same tap opens Chrome (Safari on
    # iOS) on its own -- see buy_href.
    button_key = "open_buy"
    cta.append(f'<a class="{"btn secondary" if house else "btn"}" '
               f'href="{html.escape(buy_href(page_url, agent, user_agent))}" rel="nofollow">'
               f'{fill(button_key)}</a></div>')
    info.append("".join(cta))

    if offer and not house:
        info.append(f'<p class="event">{fill("open_campaign", name=offer["name"], bonus=offer["bonus_formatted"], left=offer["left"], slots=offer["slots"])}</p>')

    info.append(f'<button class="ghost" id="copy" type="button">{fill("open_copy")}</button>')
    if in_app:
        info.append(f'<a class="stay" href="{html.escape(page_url)}/go" rel="nofollow">{fill("open_stay")}</a>')

    if not house and (product.get("shopee_rate") or product.get("seller_rate")):
        lines = []
        if product.get("shopee_rate"):
            lines.append(fill("open_rate_line", source=name, rate=_rate(product["shopee_rate"]),
                              amount=product.get("shopee_part_formatted", "")))
        if product.get("seller_rate"):
            lines.append(fill("open_rate_line", source=words.get("open_shop", ""),
                              rate=_rate(product["seller_rate"]),
                              amount=product.get("seller_part_formatted", "")))
        if product.get("is_capped"):
            lines.append(fill("open_capped"))
        if product.get("cashback"):
            lines.append(fill("open_share_line", rate=product.get("rate_percent", ""),
                              amount=product.get("cashback_formatted", "")))
        info.append(f'<details><summary>{fill("open_breakdown_title")}</summary><ul>'
                    + "".join(f"<li>{line}</li>" for line in lines) + "</ul></details>")
    info.append(f'<details><summary>{fill("open_tips_title")}</summary><ol>'
                + "".join(f"<li>{fill(k)}</li>" for k in
                          ("open_tip_1", "open_tip_2", "open_tip_3", "open_tip_4"))
                + "</ol></details>")

    media = (f'<div class="media"><img src="{picture}" alt="" referrerpolicy="no-referrer"></div>'
             if image_ok else "")
    hint = ""
    if in_app and kind == "ios":
        hint = (f'<div class="hint" id="hint" role="note"><span>{fill("open_veil_ios")}</span>'
                f'<button type="button" id="hint-close" aria-label="{fill("open_veil_close")}">&times;</button></div>')

    script = {"share": page_url, "copied": words.get("open_copied", "")}
    return f"""<!doctype html>
<html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>{title}</title>
<meta property="og:title" content="{title}">
<meta property="og:description" content="{fill("open_preview_description")}">
<meta property="og:type" content="website">
{f'<meta property="og:image" content="{picture}">' if image_ok else ""}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>{_STYLE}</style></head>
<body><div class="page">
<header class="top"><img src="/logo-mark.webp" alt=""><b>{fill("open_brand")}</b><span class="chip">{html.escape(name)}</span></header>
<article class="card">{media}<div class="info">{"".join(info)}</div></article>
<p class="foot">{fill("open_footer")}</p>
</div>{hint}
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
  var close = document.getElementById("hint-close");
  if (close) close.addEventListener("click", function () {{
    document.getElementById("hint").classList.add("off");
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
