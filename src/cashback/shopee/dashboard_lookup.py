"""Read a product's commission from Shopee's own data, for a plain link.

No third party and no Open API credentials. Two of the operator's own
logged-in tabs are used, one per site:

    1. shopee.vn        /api/v4/pdp/get_pc   item id  -> product name
    2. affiliate.shopee.vn
                        /api/v3/offer/product/list?keyword=<name>
                                             name     -> commission rate

Step 1 exists because step 2 can only search by keyword, and the links
customers actually send carry no name: a short link (vn.shp.ee/...)
resolves to /product/<shop>/<item> and nothing more. Reading the name back
from the item id is what joins the two halves. Measured on real links,
the pair finds the exact product on the first attempt.

WHY IT IS SHAPED THIS WAY, all measured 2026-09-10
--------------------------------------------------
There is no commission lookup by item id anywhere. Probed and rejected:

  - keyword=<item_id>, keyword=<product url>       0 results
  - item_id / item_ids / itemid / item_id_list / shopid params ignored
  - /api/v3/offer/product/{get,item,detail,query,search,item_detail},
    /api/v3/product/detail, /api/v3/item/get       all 404
  - GraphQL at /api/v3/gql: introspection disabled, and a capture of every
    call the offer page makes shows only the one list endpoint
  - Open API's productOfferV2(itemId:) would do it in one call, but Shopee
    restricted Open API access on 4/8/2023 to KOL/KOC accounts that have a
    named staff contact; this account was refused in writing.

The name lookup has to run inside a shopee.vn page. Plain HTTP gets 403,
and the same fetch from the affiliate tab dies on CORS. Same-origin from a
shopee.vn tab works, which is why this asks for its own pinned tab.

Only page one of the search is ever read. Paging to hunt for a missing
item got the session bounced to shopee.vn/verify/traffic/error, Shopee's
traffic guard, and recovery needed a manual reload. Not worth a number.

RATE SEMANTICS, verified against 20 products
--------------------------------------------
`default_commission_rate` is the TOTAL, already including the shop's XTRA
top-up; `seller_commission_rate` is the XTRA portion within it. Adding the
two double-counts. The base rate is the difference. Checked against an
independent source: 19 of 20 rates and 20 of 20 prices agreed exactly.
"""

from __future__ import annotations

import json
import re
import urllib.parse
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

import httpx

from ..shopee.browser_bridge import Bridge, Job
from ..core.policy import SHOPEE_COMMISSION_CAP_VND

CONNECTOR = "shopee_affiliate"
SEARCH_PATH = "/api/v3/offer/product/list"
NAME_PATH = "/api/v4/pdp/get_pc"

# The name lookup needs a tab on the storefront, not the dashboard, so it
# asks for a separately pinned one. Without the scope it would navigate the
# dashboard tab away mid-job.
STORE_ROUTING = {"hosts": ["shopee.vn"], "url": "https://shopee.vn/"}
STORE_SCOPE = "store"

# Prices arrive multiplied by this on the offer endpoint.
PRICE_SCALE = 100_000

# How much of the product name to search with. Full names are keyword
# stuffed and match nothing; the leading words are the actual product.
KEYWORD_WORDS = 6

# Every domain Shopee hands out, in one place. Keeping a second copy
# somewhere else is how a customer's link stops being recognised: the bot
# once missed shp.ee because the handler's list had shope.ee and not this.
SHORT_DOMAINS = ("s.shopee.vn", "shope.ee", "shp.ee")
ALL_DOMAINS = ("shopee.vn", "shope.ee", "shp.ee")

# Matches any host ending in one of the domains above, so vn.shp.ee and
# s.shopee.vn are covered without being listed separately.
ANY_SHOPEE_URL = re.compile(
    r"https?://(?:[\w-]+\.)*(?:" + "|".join(d.replace(".", r"\.") for d in ALL_DOMAINS)
    + r")/\S+",
    re.IGNORECASE,
)

IDS_FROM_URL = re.compile(r"/([^/?#]*?)-i\.(\d+)\.(\d+)")

# Two long numeric path segments in a row are shop id then item id. The
# segment in front of them varies -- /product/ is the common one, but a
# short link opened on mobile lands on things like /opaanlp/ -- so the
# prefix is deliberately not part of the match.
IDS_FROM_PATH = re.compile(r"/(\d{5,})/(\d{5,})(?:[/?#]|$)")
SHORT_LINK = re.compile(
    "(" + "|".join(d.replace(".", r"\.") for d in SHORT_DOMAINS) + ")/",
    re.IGNORECASE,
)


def round_dong(amount: float) -> int:
    """Round to whole dong, halves upward.

    Python's round() sends a half to the nearest EVEN number, so
    9262.5 becomes 9262 while every other tool in this market shows
    9263. A one dong gap is nothing to pay out, but a customer who
    compares two bots and sees different figures has no way to tell
    which one is shading them.
    """
    return int(Decimal(str(amount)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


@dataclass(frozen=True)
class Commission:
    item_id: str
    name: str
    price: int
    total_rate: float           # percent, XTRA included
    seller_rate: float          # percent, the XTRA portion within the total
    long_link: str

    @property
    def base_rate(self) -> float:
        """Shopee's own share, once the shop's top-up is taken out."""
        return round(self.total_rate - self.seller_rate, 2)

    def estimate(self, price: int | None = None) -> int:
        """Commission Shopee would pay, with its own share capped.

        Applying total_rate straight to the price overstates every
        expensive item, because Shopee caps its own portion and the
        dashboard reports the rate before that cap.
        """
        base = price if price is not None else self.price
        shopee = min(base * self.base_rate / 100, SHOPEE_COMMISSION_CAP_VND)
        return round_dong(shopee + base * self.seller_rate / 100)

    def shopee_part(self, price: int | None = None) -> int:
        base = price if price is not None else self.price
        return round_dong(min(base * self.base_rate / 100,
                              SHOPEE_COMMISSION_CAP_VND))

    def is_capped(self, price: int | None = None) -> bool:
        base = price if price is not None else self.price
        return base * self.base_rate / 100 > SHOPEE_COMMISSION_CAP_VND

    def seller_part(self, price: int | None = None) -> int:
        base = price if price is not None else self.price
        return round_dong(base * self.seller_rate / 100)

    def cashback(self, rate: float, price: int | None = None) -> int:
        return round_dong(self.estimate(price) * rate)


def parse_rate(value) -> float:
    """Rates arrive as strings like '7,5%'. Vietnamese uses a comma decimal."""
    if value is None:
        return 0.0
    text = str(value).replace("%", "").replace(",", ".").strip()
    try:
        return float(text)
    except ValueError:
        return 0.0


def is_short_link(url: str) -> bool:
    return bool(SHORT_LINK.search(url or ""))


def resolve_short_link(url: str, timeout: float = 12.0) -> str:
    try:
        with httpx.Client(follow_redirects=True, timeout=timeout) as client:
            return str(client.get(url).url)
    except httpx.HTTPError:
        return url


def parse_url(url: str) -> tuple[str, str, str] | None:
    """Return (slug, shop_id, item_id) from a Shopee product URL.

    The slug is empty for the /product/<shop>/<item> form, which is what
    every short link resolves to.
    """
    match = IDS_FROM_URL.search(url or "")
    if match:
        slug = urllib.parse.unquote(match.group(1)).replace("-", " ")
        return slug, match.group(2), match.group(3)
    match = IDS_FROM_PATH.search(url or "")
    if match:
        return "", match.group(1), match.group(2)
    return None


def keyword_from_name(name: str, words: int = KEYWORD_WORDS) -> str:
    cleaned = re.sub(r"\s+", " ", name or "").strip()
    return " ".join(cleaned.split(" ")[:words])


def _run(bridge: Bridge, code: str, routing: dict | None = None,
         scope: str | None = None, timeout: float = 60) -> dict:
    params: dict = {"code": code}
    if routing:
        params["_routing"] = routing
        params["_tab_scope"] = scope
    value = bridge.submit(
        Job(connector=CONNECTOR, action="execute_script", params=params),
        timeout=timeout,
    )
    return (value or {}).get("result") or {}


_NAME_JS = """
(async () => {
  const response = await fetch(%(path)s + '?item_id=%(item)s&shop_id=%(shop)s',
                               { credentials: 'include' });
  if (!response.ok) return { ok: false, status: response.status };
  const body = await response.json();
  const item = body && body.data && body.data.item;
  if (!item || !item.title) return { ok: false, why: 'no title' };
  return { ok: true, name: item.title };
})()
"""


def product_name(bridge: Bridge, shop_id: str, item_id: str) -> str:
    """Read a product's name from the storefront. '' when unavailable."""
    code = _NAME_JS % {
        "path": json.dumps(NAME_PATH),
        "item": item_id,
        "shop": shop_id,
    }
    try:
        found = _run(bridge, code, STORE_ROUTING, STORE_SCOPE)
    except RuntimeError:
        return ""
    return str(found.get("name") or "") if found.get("ok") else ""


_SEARCH_JS = """
(async () => {
  const url = %(path)s + '?list_type=0&sort_type=1&client_type=1'
            + '&page_offset=0&page_limit=%(limit)d'
            + '&keyword=' + encodeURIComponent(%(keyword)s);
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) return { ok: false, status: response.status };
  const body = await response.json();
  const list = (body && body.data && body.data.list) || [];
  const hit = list.find(x => String(x.item_id) === %(item_id)s);
  if (!hit) return { ok: false, why: 'not on page one', seen: list.length };
  const card = hit.batch_item_for_item_card_full || {};
  return {
    ok: true,
    name: card.name || '',
    price: card.price || 0,
    total_rate: hit.default_commission_rate || '',
    seller_rate: hit.seller_commission_rate || '',
    long_link: hit.long_link || '',
  };
})()
"""


def lookup(bridge: Bridge, url: str, page_limit: int = 50) -> Commission | None:
    """Find the commission for one product URL. None when it cannot be
    pinned down to that exact item.

    Never raises: a failed lookup must degrade to showing no estimate, not
    stop a link from being delivered. Reporting a near-miss from another
    listing would be worse than reporting nothing.
    """
    target = resolve_short_link(url) if is_short_link(url) else url
    parsed = parse_url(target)
    if not parsed:
        return None
    slug, shop_id, item_id = parsed

    # The storefront name is what the dashboard indexes. A slug is only a
    # fallback for when the storefront will not answer.
    name = product_name(bridge, shop_id, item_id) or slug
    keyword = keyword_from_name(name)
    if not keyword:
        return None

    code = _SEARCH_JS % {
        "path": json.dumps(SEARCH_PATH),
        "keyword": json.dumps(keyword),
        "item_id": json.dumps(item_id),
        "limit": page_limit,
    }
    try:
        found = _run(bridge, code)
    except RuntimeError:
        return None
    if not found.get("ok"):
        return None

    return Commission(
        item_id=item_id,
        name=str(found.get("name") or name),
        price=int(found.get("price") or 0) // PRICE_SCALE,
        total_rate=parse_rate(found.get("total_rate")),
        seller_rate=parse_rate(found.get("seller_rate")),
        long_link=str(found.get("long_link") or ""),
    )
