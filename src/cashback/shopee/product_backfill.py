"""Fill in product name and picture for link requests saved without them.

Requests made before pictures were stored carry a short link
(s.shopee.vn, vn.shp.ee) and an estimate with no image and no item id.
A short link does not contain the item id, so nothing downstream could
find the product again, and the console showed a blank box.

Only descriptive fields are added -- name, image, item id. The estimate's
money figures are left exactly as they were: they are what the customer
was quoted, and rewriting them after the fact would change history.
"""

from __future__ import annotations

import json
import sqlite3
import time
from dataclasses import dataclass
from typing import Callable

from . import commission
from .dashboard_lookup import is_short_link, parse_url, resolve_short_link
from ..ledger import repository as ledger


@dataclass
class Filled:
    request_id: str
    item_id: str | None
    name: str
    image_url: str
    source: str        # "cache", "lookup", or why nothing was found


def _detail(raw: str | None) -> dict:
    try:
        value = json.loads(raw or "{}")
        return value if isinstance(value, dict) else {}
    except ValueError:
        return {}


def missing_pictures(conn: sqlite3.Connection, only_ordered: bool = True) -> list[sqlite3.Row]:
    """Link requests with a link but no stored picture."""
    scope = ("AND r.request_id IN (SELECT request_id FROM orders"
             " WHERE request_id IS NOT NULL)") if only_ordered else ""
    rows = conn.execute(
        "SELECT r.request_id, r.source_url, r.estimate_detail FROM link_requests r"
        " WHERE r.affiliate_url IS NOT NULL AND r.affiliate_url != '' " + scope +
        " ORDER BY r.created_at DESC").fetchall()
    return [r for r in rows if not _detail(r["estimate_detail"]).get("image_url")]


def fill(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    apply: bool,
    resolve: Callable[[str], str] = resolve_short_link,
    look_up: Callable[..., object] = commission.lookup,
) -> Filled:
    detail = _detail(row["estimate_detail"])
    source_url = row["source_url"] or ""

    item_id = detail.get("item_id")
    shop_id = ""
    target = source_url
    if not item_id:
        parsed = parse_url(source_url)
        if not parsed and is_short_link(source_url):
            target = resolve(source_url)
            parsed = parse_url(target)
        if parsed:
            _, shop_id, item_id = parsed
    if not item_id:
        return Filled(row["request_id"], None, "", "", "item id not found")
    item_id = str(item_id)

    cached = ledger.get_product_cache(conn, item_id)
    if cached and cached["image_url"]:
        name, image, found_by = cached["name"] or "", cached["image_url"], "cache"
    else:
        target = target if parse_url(target) else f"https://shopee.vn/product/{shop_id}/{item_id}"
        estimate = look_up(target, third_party=True)
        if estimate is None or not getattr(estimate, "image_url", ""):
            return Filled(row["request_id"], item_id, "", "", "no picture from lookup")
        name, image, found_by = estimate.name or "", estimate.image_url, "lookup"
        if apply and cached:
            # upsert_product_cache would reset is_capped on an existing row,
            # so a row that only lacks a picture gets only the picture.
            conn.execute(
                "UPDATE products_cache SET image_url=?,"
                " name=COALESCE(NULLIF(name, ''), ?) WHERE item_id=?",
                (image, name, item_id))
        elif apply:
            # Product facts only. A link never goes into the shared cache.
            ledger.upsert_product_cache(
                conn, item_id=item_id, shop_id=shop_id, name=name,
                price=getattr(estimate, "price", 0) or 0,
                image_url=image, canonical_url=target)

    if apply:
        detail.setdefault("name", name)
        detail["image_url"] = image
        detail["item_id"] = item_id
        conn.execute(
            "UPDATE link_requests SET estimate_detail=? WHERE request_id=?",
            (json.dumps(detail, ensure_ascii=False), row["request_id"]))
    return Filled(row["request_id"], item_id, name, image, found_by)


def run(conn: sqlite3.Connection, apply: bool, only_ordered: bool = True,
        pause_seconds: float = 1.5, **hooks) -> list[Filled]:
    """Fill every request missing a picture, politely spaced."""
    results = []
    for index, row in enumerate(missing_pictures(conn, only_ordered)):
        if index:
            time.sleep(pause_seconds)
        results.append(fill(conn, row, apply, **hooks))
    return results
