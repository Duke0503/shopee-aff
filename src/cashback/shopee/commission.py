"""One way to ask "what is this product's commission", two sources behind it.

Order matters and is not configurable:

    1. shopee_lookup   Shopee's own data, read through the operator's own
                       logged-in session. Authoritative, free, no terms to
                       argue about -- but its product search does not index
                       the whole catalogue, so it answers most links and
                       not all.

    2. product_info    A third party, tried only when Shopee's own data
                       came back empty. Near-perfect agreement when both
                       answer (19/20 rates, 20/20 prices), but cached by
                       about a day and offered by its provider for
                       non-commercial use only. Off in one line via
                       THIRD_PARTY_FALLBACK.

Every result says which source produced it, and carries the same
breakdown whichever source it came from, so the customer sees identical
wording either way.

Whatever comes back is an ESTIMATE. Cashback is always paid from the
commission Shopee actually approves.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass

from ..core.policy import SHOPEE_COMMISSION_CAP_VND
from ..shopee.dashboard_lookup import round_dong

SOURCE_SHOPEE = "shopee"
SOURCE_THIRD_PARTY = "third_party"


@dataclass(frozen=True)
class Estimate:
    """A commission estimate, broken into the parts a customer is shown.

    `commission` is already capped: Shopee limits its own share of a
    single order, the shop's XTRA top-up rides on top uncapped.
    """

    commission: int            # VND, cap applied
    price: int                 # VND
    total_rate: float          # percent, XTRA included
    shopee_rate: float         # percent, Shopee's base share
    seller_rate: float         # percent, the shop's XTRA top-up
    shopee_part: int           # VND, capped
    seller_part: int           # VND
    is_capped: bool
    name: str
    source: str

    def cashback(self, rate: float) -> int:
        return round_dong(self.commission * rate)

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False)

    @staticmethod
    def from_json(text: str) -> "Estimate | None":
        try:
            return Estimate(**json.loads(text))
        except (ValueError, TypeError):
            return None


def _build(price: int, shopee_rate: float, seller_rate: float,
           name: str, source: str) -> Estimate:
    """Apply the cap once, in one place, whichever source supplied the rates."""
    raw_shopee = price * shopee_rate / 100
    capped = raw_shopee > SHOPEE_COMMISSION_CAP_VND
    shopee_part = round_dong(min(raw_shopee, SHOPEE_COMMISSION_CAP_VND))
    seller_part = round_dong(price * seller_rate / 100)
    return Estimate(
        commission=shopee_part + seller_part,
        price=price,
        total_rate=round(shopee_rate + seller_rate, 2),
        shopee_rate=shopee_rate,
        seller_rate=seller_rate,
        shopee_part=shopee_part,
        seller_part=seller_part,
        is_capped=capped,
        name=name,
        source=source,
    )


def lookup(url: str, bridge=None, third_party: bool = True) -> Estimate | None:
    """Best available estimate for a product URL, or None.

    Never raises. A missing estimate is a normal outcome: the link is
    still delivered, just without a number. Quoting a figure that later
    disagrees with the payout is worse than quoting none.
    """
    if bridge is not None:
        from ..shopee import dashboard_lookup as shopee_lookup

        try:
            found = shopee_lookup.lookup(bridge, url)
        except Exception:
            found = None
        if found and found.total_rate > 0 and found.price > 0:
            return _build(found.price, found.base_rate, found.seller_rate,
                          found.name, SOURCE_SHOPEE)

    if not third_party:
        return None

    from ..shopee import third_party_lookup as product_info

    try:
        other = product_info.lookup(url)
    except Exception:
        other = None
    if other and other.total_rate > 0 and other.price > 0:
        return _build(other.price, other.shopee_rate, other.seller_rate,
                      other.name, SOURCE_THIRD_PARTY)

    return None
