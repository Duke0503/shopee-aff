"""What /s/<code> answers, by who is asking.

  - A real browser (Chrome, Safari, a desktop): a plain redirect to the
    affiliate link. The customer barely sees us.
  - An in-app browser (Zalo, Facebook, ...): a small page. On Android it
    asks Chrome to open this same address, which then redirects; iOS lets
    no page leave an in-app browser on its own, so the page offers a
    Safari button (x-safari-https, iOS 17+) and says where the "open in
    browser" menu is. A last link still opens the offer in place, for
    someone who cannot get out -- a purchase that might not be credited
    beats no purchase.
  - A link-preview bot: the same page, which carries the product's name
    and picture for the preview card. Bots do not run the script, and are
    not counted as clicks.

Every word on the page comes from resources/dashboard.vi.json (open_*).
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


def is_safe_target(url: str) -> bool:
    return bool(url) and url.lower().startswith("https://")


def android_intent(share_url: str, fallback: str) -> str:
    """Open share_url in Chrome; if Chrome is missing, go to fallback."""
    parts = urllib.parse.urlsplit(share_url)
    rest = parts.netloc + parts.path + (f"?{parts.query}" if parts.query else "")
    return (f"intent://{rest}#Intent;scheme={parts.scheme};package=com.android.chrome;"
            f"S.browser_fallback_url={urllib.parse.quote(fallback, safe='')};end")


def render_guide(words: dict, share_url: str, target: str, platform: str,
                 user_agent: str, product: dict) -> str:
    """The page for in-app browsers and preview bots."""
    name = PLATFORM_NAMES.get(platform or "shopee", "Shopee")
    fill = lambda key: html.escape(words.get(key, "").replace("{platform}", name))  # noqa: E731
    kind = device(user_agent)
    safari = "x-safari-" + share_url
    intent = android_intent(share_url, target)
    title = html.escape(product.get("name") or words.get("open_title", "").replace("{platform}", name))
    image = product.get("image_url") or ""
    image_meta = (f'<meta property="og:image" content="{html.escape(image)}">'
                  if is_safe_target(image) else "")

    if kind == "android":
        primary = f'<a class="btn" href="{html.escape(intent)}">{fill("open_button_android")}</a>'
        steps = fill("open_android_steps")
    else:
        primary = f'<a class="btn" href="{html.escape(safari)}">{fill("open_button_ios")}</a>'
        steps = fill("open_ios_steps")

    script = {
        "device": kind,
        "intent": intent,
        "share": share_url,
        "copied": words.get("open_copied", ""),
    }
    return f"""<!doctype html>
<html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>{title}</title>
<meta property="og:title" content="{title}">
<meta property="og:description" content="{fill("open_preview_description")}">
{image_meta}
<style>
:root {{ --bg:#fff7f2; --card:#ffffff; --ink:#1f1f1f; --muted:#6b6b6b; --brand:#ee4d2d; --line:#f1d9cf; }}
@media (prefers-color-scheme: dark) {{ :root {{ --bg:#141414; --card:#1f1f1f; --ink:#f2f2f2; --muted:#a8a8a8; --brand:#ff6a4d; --line:#333; }} }}
* {{ box-sizing:border-box; }}
body {{ margin:0; background:var(--bg); color:var(--ink); font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }}
main {{ max-width:440px; margin:0 auto; padding:24px 16px 40px; }}
.card {{ background:var(--card); border:1px solid var(--line); border-radius:16px; padding:20px; }}
h1 {{ font-size:20px; line-height:1.3; margin:0 0 8px; }}
p {{ margin:0 0 14px; color:var(--muted); }}
.product {{ color:var(--ink); font-weight:600; }}
.btn {{ display:block; text-align:center; background:var(--brand); color:#fff; text-decoration:none;
        font-weight:700; padding:14px; border-radius:12px; margin:18px 0 12px; }}
.ghost {{ display:block; width:100%; text-align:center; background:transparent; color:var(--ink);
          border:1px solid var(--line); font:inherit; font-weight:600; padding:12px; border-radius:12px; }}
.steps {{ font-size:14px; }}
.stay {{ display:block; text-align:center; margin-top:18px; font-size:13px; color:var(--muted); }}
</style></head>
<body><main><div class="card">
<h1>{fill("open_in_app_heading")}</h1>
{f'<p class="product">{html.escape(product["name"])}</p>' if product.get("name") else ""}
<p>{fill("open_in_app_body")}</p>
{primary}
<p class="steps">{steps}</p>
<button class="ghost" id="copy" type="button">{fill("open_copy")}</button>
<a class="stay" href="{html.escape(target)}" rel="nofollow">{fill("open_stay")}</a>
</div></main>
<script>
(function () {{
  var s = {json.dumps(script, ensure_ascii=False)};
  if (s.device === "android") {{ window.location.href = s.intent; }}
  var btn = document.getElementById("copy");
  btn.addEventListener("click", function () {{
    function done() {{ btn.textContent = s.copied; }}
    if (navigator.clipboard && navigator.clipboard.writeText) {{
      navigator.clipboard.writeText(s.share).then(done, function () {{ window.prompt("", s.share); }});
    }} else {{ window.prompt("", s.share); }}
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
<style>body{{margin:0;font:16px/1.5 system-ui,sans-serif;background:#fff7f2;color:#1f1f1f}}
@media (prefers-color-scheme: dark){{body{{background:#141414;color:#f2f2f2}}}}
main{{max-width:440px;margin:0 auto;padding:40px 16px}}h1{{font-size:20px}}</style></head>
<body><main><h1>{fill("open_not_found_title")}</h1><p>{fill("open_not_found_body")}</p></main></body></html>"""
