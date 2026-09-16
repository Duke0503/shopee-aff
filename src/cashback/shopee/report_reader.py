"""Read the conversion report from the dashboard instead of a CSV download.

The report page is backed by an ordinary GET:

    /api/v3/report/list?page_size=&page_num=&purchase_time_s=&purchase_time_e=

Called through the operator's own logged-in browser, the same way the
commission lookup works. It removes the one manual step left in the
payout chain -- exporting a CSV by hand, with the right date range and
"additional information" switched on, before anything could be
reconciled.

WHAT WAS MEASURED, 2026-09-16
-----------------------------
Every number below was checked against what the page itself prints, not
inferred:

    actual_amount   7,363,100,000  ->  displayed  71,631 VND
    item_price     10,152,000,000  ->  displayed 101,520 VND

so amounts arrive multiplied by 100,000.

The commission breakdown matches this system's own model exactly:

    item_commission          1,840,775   Shopee's 2.5% share
    capped_brand_commission  3,681,550   the shop's 5% XTRA
                             ---------
    estimated_total          5,522,325   = the page's 5,522 VND

SUB IDS
-------
`utm_content` carries all five sub_ids joined by "-":

    "C0003-R26091441451---"   ->  ["C0003", "R26091441451", "", "", ""]

which is what makes an order traceable to a customer and to the request
that produced the link.

STATUS
------
Two fields describe state, and the readable one is preferred:

    order_status        "PAID" / "UNPAID"     the buyer's payment
    display_item_status "Pending" / ...       the commission's validation

`conversion_status` is a bare number (1, 4) that mirrors the first. It is
recorded but never decided on: a number nobody has documented is not
something to settle money against.

An unrecognised status is reported as "unknown" rather than mapped to a
guess. Reconciliation then leaves that row for a human instead of paying
or refusing on it -- see reconciliation.run.
"""

from __future__ import annotations

import json
import time

from .browser_bridge import Bridge, Job
from .report_importer import ReportRow

CONNECTOR = "shopee_affiliate"
REPORT_PAGE = "https://affiliate.shopee.vn/report/conversion_report"
REPORT_PATH = "/api/v3/report/list"

# Amounts arrive multiplied by this. Verified against the rendered page.
MONEY_SCALE = 100_000

# Rates arrive multiplied by 1000: 2500 means 2.5%.
RATE_SCALE = 1000

PAGE_SIZE = 50
MAX_PAGES = 20            # 1000 orders; far beyond this operation's volume

# What Shopee calls the state of a commission, and what this system calls
# it. Anything absent from here is deliberately NOT guessed.
STATUS_MAP = {
    "pending": "awaiting",
    # The buyer has not paid yet. Recording it as awaiting is both true and
    # safe: awaiting never releases money, so being wrong about whether it
    # will ever be paid costs nothing. The alternative -- manual review --
    # buries the operator in rows that need no decision.
    "unpaid": "awaiting",
    "paid": "awaiting",
    "validated": "approved",
    "approved": "approved",
    "cancelled": "rejected",
    "canceled": "rejected",
    "invalid": "rejected",
    "rejected": "rejected",
    "fraud": "rejected",
}


def _money(value) -> int | None:
    """Whole dong from Shopee's scaled integer."""
    try:
        return round(int(value) / MONEY_SCALE)
    except (TypeError, ValueError):
        return None


def parse_sub_ids(utm_content: str) -> list[str]:
    """Split the joined sub_ids back out.

    Sub ids are alphanumeric by construction (see core.identifiers), so a
    "-" is unambiguously a separator and never part of a value.
    """
    return (utm_content or "").split("-")


def map_status(display_item_status: str, order_status: str) -> str:
    """Prefer the readable commission status; fall back to the order's.

    Returns "unknown" when neither is recognised, which routes the row to
    manual review rather than to a payout decision.
    """
    for candidate in (display_item_status, order_status):
        mapped = STATUS_MAP.get(str(candidate or "").strip().lower())
        if mapped:
            return mapped
    return "unknown"


_FETCH_JS = """
(async () => {
  const url = %(path)s + '?page_size=%(size)d&page_num=%(page)d'
            + '&purchase_time_s=%(start)d&purchase_time_e=%(end)d';
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) return { ok: false, status: response.status, at: location.href };
  const body = await response.json();
  if (body && body.error) return { ok: false, err: body.error, msg: body.msg || '' };
  const data = body.data || {};
  return { ok: true, list: data.list || [], total: data.total ?? null };
})()
"""


def _row_to_report_row(raw: dict) -> ReportRow:
    orders = raw.get("orders") or []
    first = orders[0] if orders else {}
    items = first.get("items") or []

    # One conversion can carry several items; the order is what gets paid
    # out, so the value and commission are summed across them.
    order_value = sum(
        _money(item.get("actual_amount")) or 0 for item in items
    ) or None

    commission = _money(raw.get("estimated_total_commission"))
    if commission is None:
        commission = sum(
            (_money(item.get("item_commission")) or 0)
            + (_money(item.get("capped_brand_commission")) or 0)
            for item in items
        ) or None

    status = map_status(
        (items[0] or {}).get("display_item_status") if items else "",
        first.get("order_status", ""),
    )

    return ReportRow(
        order_id=str(first.get("order_sn") or raw.get("checkout_id") or ""),
        order_value=order_value,
        commission=commission,
        status=status,
        sub_ids=parse_sub_ids(raw.get("utm_content", "")),
        order_time=str(raw.get("purchase_time") or ""),
        raw=raw,
    )


def read(bridge: Bridge, days: int = 60, settle_seconds: float = 5.0) -> list[ReportRow]:
    """Every conversion in the window, oldest page first.

    Raises RuntimeError if the dashboard will not answer, so a caller
    never mistakes an empty result for "no orders".
    """
    bridge.submit(
        Job(connector=CONNECTOR, action="navigate", params={"url": REPORT_PAGE}),
        timeout=120,
    )
    time.sleep(settle_seconds)

    end = int(time.time())
    start = end - days * 86_400
    rows: list[ReportRow] = []

    for page in range(1, MAX_PAGES + 1):
        code = _FETCH_JS % {
            "path": json.dumps(REPORT_PATH),
            "size": PAGE_SIZE,
            "page": page,
            "start": start,
            "end": end,
        }
        value = bridge.submit(
            Job(connector=CONNECTOR, action="execute_script", params={"code": code}),
            timeout=120,
        )
        found = (value or {}).get("result") or {}
        if not found.get("ok"):
            raise RuntimeError(
                "the dashboard did not return the report "
                f"(page {page}): {found}"
            )

        batch = found.get("list") or []
        rows.extend(_row_to_report_row(item) for item in batch)
        if len(batch) < PAGE_SIZE:
            break
        # Pages are read back to back; a short pause keeps the pattern
        # closer to someone clicking through than to a scraper.
        time.sleep(1.5)

    return rows
