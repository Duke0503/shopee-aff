"""Third-party commission lookup, used only when Shopee's own data misses.

    https://data.addlivetag.com/product-data/product-data.php

It is the backend of a Vietnamese browser extension that shows Shopee
commissions. It takes no credentials and accepts an item id or a URL.

WHY IT IS HERE AT ALL
---------------------
Shopee's own dashboard is the first source (see shopee_lookup), but its
product search does not index the whole catalogue: a product can carry a
real commission and still be absent from every keyword search. Measured
example, item 19090086744, "Combo 2 Banh mi sandwich Staff": 8.5% real
commission, invisible to four different searches including its exact full
name. Neither remaining Shopee route is open to this account -- Open API
access was refused in writing, and Product Feed reports no data.

HOW GOOD IT IS
--------------
Measured against Shopee's own dashboard over 20 products: 19 of 20
commission rates matched exactly, 20 of 20 prices matched to the dong.
The one disagreement was a stale rate on this side, which is expected --
their data is cached, roughly 24 hours by their own documentation.

Treat everything it returns as an ESTIMATE:

  - it is someone else's server; it can rate-limit, change shape, start
    charging, or vanish, so every caller must cope with getting nothing
  - a cached rate may lag a change made today
  - a product with variants reports one price; the buyer may pick another

Cashback is still paid on the commission Shopee actually approves, never
on this figure.

LICENCE, IN THE PROVIDER'S OWN WORDS
------------------------------------
Every response carries a `legalNotice` block declaring

    "purpose": "for_education_research_internal_non_commercial"
    "nonCommercialOnly": true

A cashback operation is commercial. The operator was shown this and chose
to use it as a fallback regardless; that decision is recorded here rather
than hidden. It stays behind THIRD_PARTY_FALLBACK so it can be switched
off in one line, and it is never the first source.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import httpx

# Shortener domains come from shopee_lookup so there is only ever one
# list to keep right: the two drifted apart once and shp.ee links were
# silently treated as ordinary chat.
from ..shopee.dashboard_lookup import SHORT_LINK

API_URL = "https://data.addlivetag.com/product-data/product-data.php"
TIMEOUT = 12.0

ITEM_FROM_URL = re.compile(r"-i\.(\d+)\.(\d+)")

# Two long numeric path segments in a row are shop id then item id,
# whatever the segment in front of them happens to be.
ITEM_FROM_PATH = re.compile(r"/(\d{5,})/(\d{5,})(?:[/?#]|$)")


@dataclass(frozen=True)
class ProductInfo:
    item_id: str
    name: str
    shop_name: str
    price: int
    total_commission: int
    total_rate: float          # percent, XTRA included
    seller_rate: float         # percent, the XTRA portion
    shopee_rate: float         # percent, Shopee's base share
    cap: int | None
    is_capped: bool
    has_xtra: bool
    last_update: str
    image_url: str = ""

    def cashback(self, rate: float) -> int:
        return round(self.total_commission * rate)


def extract_ids(url: str) -> tuple[str, str] | None:
    """Pull (shop_id, item_id) out of a Shopee product URL."""
    for pattern in (ITEM_FROM_URL, ITEM_FROM_PATH):
        match = pattern.search(url or "")
        if match:
            return match.group(1), match.group(2)
    return None


def is_short_link(url: str) -> bool:
    return bool(SHORT_LINK.search(url or ""))


def resolve_short_link(url: str, timeout: float = TIMEOUT) -> str:
    try:
        with httpx.Client(follow_redirects=True, timeout=timeout) as client:
            return str(client.get(url).url)
    except httpx.HTTPError:
        return url


def _to_int(value) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def _to_float(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def lookup(url: str, timeout: float = TIMEOUT) -> ProductInfo | None:
    """Fetch commission details for a product URL. None when unavailable.

    Never raises: a lookup failure must degrade to "no estimate shown",
    not stop a link being delivered.
    """
    target = resolve_short_link(url, timeout) if is_short_link(url) else url
    ids = extract_ids(target)

    params = {"item_id": ids[1]} if ids else {"url": target}

    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.get(API_URL, params=params)
        body = response.json()
    except (httpx.HTTPError, ValueError):
        return None

    if not isinstance(body, dict) or body.get("status") != "success":
        return None
    data = body.get("productInfo")
    if not isinstance(data, dict):
        return None
    # An unknown product still comes back as "success" with an empty shell.
    # Reporting that as a real answer would show the customer 0 VND.
    if not data.get("itemId") or not data.get("productName"):
        return None

    cap = data.get("cap")
    return ProductInfo(
        item_id=str(data.get("itemId")),
        name=str(data.get("productName") or ""),
        shop_name=str(data.get("shopName") or ""),
        price=_to_int(data.get("price")),
        total_commission=_to_int(data.get("commission")),
        total_rate=_to_float(data.get("totalRatePercent")),
        seller_rate=_to_float(data.get("sellerRatePercent")),
        shopee_rate=_to_float(data.get("shopeeRatePercent")),
        cap=_to_int(cap) if cap else None,
        is_capped=bool(data.get("isCapped")),
        has_xtra=bool(data.get("isXtra")),
        last_update=str(data.get("lastUpdate") or ""),
        image_url=str(data.get("imageUrl") or ""),
    )
