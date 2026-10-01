"""Sync Shopee payout records and reconcile with ledger orders.

Reads from https://affiliate.shopee.vn/payment/payout_record through the
logged-in operator browser via the extension bridge.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

from ..ledger import repository as ledger
from .browser_bridge import Bridge, Job

log = logging.getLogger(__name__)

CONNECTOR = "shopee_affiliate"
PAYOUT_PAGE = "https://affiliate.shopee.vn/payment/payout_record"
VN_TZ = timezone(timedelta(hours=7))

# Shopee amounts are scaled by 100,000
MONEY_SCALE = 100_000

# Script to extract payout records using React fiber or DOM table fallback
EXTRACT_SCRIPT = r"""(() => {
  const rows = Array.from(document.querySelectorAll('tr[data-row-key]'));
  const records = [];
  for (const row of rows) {
    const fiberKey = Object.keys(row).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
    let record = null;
    if (fiberKey) {
      let cur = row[fiberKey];
      while (cur && !record) {
        if (cur.memoizedProps && cur.memoizedProps.record) {
          record = cur.memoizedProps.record;
        }
        cur = cur.return;
      }
    }
    if (record && !records.some(r => r.payoutId === String(record.payoutId || ''))) {
      records.push({
        payoutId: String(record.payoutId || ''),
        payoutPaymentStatus: Number(record.payoutPaymentStatus || 0),
        totalPaymentAmount: String(record.totalPaymentAmount || '0'),
        eligibleTotalAmount: String(record.eligibleTotalAmount || '0'),
        payoutCreatedTime: Number(record.payoutCreatedTime || 0),
        payArrivalTime: Number(record.payArrivalTime || 0),
        accountType: record.accountType,
        invoiceStatus: record.invoiceStatus
      });
    }
  }

  // Fallback if fiber not found: parse DOM text
  if (records.length === 0) {
    const trs = Array.from(document.querySelectorAll('tbody tr'));
    for (const tr of trs) {
      const key = tr.getAttribute('data-row-key');
      const tds = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim());
      if (key && tds.length >= 4 && !records.some(r => r.payoutId === key)) {
        const statusText = tds[3] || '';
        let st = 9;
        if (statusText.includes('Đã thanh toán')) st = 10;
        else if (statusText.includes('Đang xử lý')) st = 1;

        const cleanVal = (tds[2] || '').replace(/[^\d]/g, '');
        records.push({
          payoutId: key,
          payoutPaymentStatus: st,
          totalPaymentAmount: cleanVal ? cleanVal + '00000' : '0',
          eligibleTotalAmount: cleanVal ? cleanVal + '00000' : '0',
          payoutCreatedTime: 0,
          payArrivalTime: 0
        });
      }
    }
  }

  return { ok: true, count: records.length, records, url: location.href };
})()"""


def _parse_ts(ts: int | float | str | None) -> str | None:
    if not ts:
        return None
    try:
        val = int(ts)
        if val <= 0:
            return None
        return datetime.fromtimestamp(val, tz=VN_TZ).isoformat()
    except (ValueError, TypeError, OSError):
        return None


def fetch_payout_records(bridge: Bridge, timeout: float = 30.0) -> list[dict[str, Any]]:
    """Query the payout record table from Shopee Affiliate Portal."""
    # Ensure navigation to payout record page
    bridge.submit(
        Job(connector=CONNECTOR, action="navigate", params={"url": PAYOUT_PAGE}),
        timeout=timeout,
    )
    time.sleep(2.5)

    value = bridge.submit(
        Job(connector=CONNECTOR, action="execute_script", params={"code": EXTRACT_SCRIPT}),
        timeout=timeout,
    )
    res = (value or {}).get("result") or {}
    raw_records = res.get("records") or []

    parsed = []
    for r in raw_records:
        pid = str(r.get("payoutId") or "").strip()
        if not pid:
            continue

        st_num = int(r.get("payoutPaymentStatus") or 0)
        # 10 = Paid (Đã thanh toán), 1 = Processing (Đang xử lý), 9 = Failed
        status = "paid" if st_num == 10 else ("processing" if st_num == 1 else "failed")

        try:
            net_amt = int(int(r.get("totalPaymentAmount") or 0) / MONEY_SCALE)
        except (ValueError, TypeError):
            net_amt = 0

        try:
            eligible_amt = int(int(r.get("eligibleTotalAmount") or 0) / MONEY_SCALE)
        except (ValueError, TypeError):
            eligible_amt = net_amt

        created_iso = _parse_ts(r.get("payoutCreatedTime")) or ledger.now()
        paid_iso = _parse_ts(r.get("payArrivalTime"))

        parsed.append({
            "payout_id": pid,
            "status": status,
            "net_amount": net_amt,
            "eligible_amount": eligible_amt,
            "created_time": created_iso,
            "paid_time": paid_iso,
            "raw": r,
        })

    return parsed


def sync_shopee_payouts(db_path: Path, bridge: Bridge) -> dict[str, Any]:
    """Run payout synchronization and update orders settlement state."""
    batches = fetch_payout_records(bridge)
    if not batches:
        log.info("[payout_sync] No payout records returned from browser.")
        return {"ok": True, "batches_synced": 0, "orders_settled": 0}

    settled_count = 0
    with ledger.connect(db_path) as conn:
        for b in batches:
            ledger.save_payout_batch(
                conn=conn,
                batch_id=b["payout_id"],
                platform="shopee",
                status=b["status"],
                amount=b["net_amount"],
                eligible_amount=b["eligible_amount"],
                created_time=b["created_time"],
                paid_time=b["paid_time"],
                raw_json=json.dumps(b["raw"], ensure_ascii=False),
            )

            # If Shopee marked this batch as paid, settle orders created on or before batch date
            if b["status"] == "paid":
                paid_at = b["paid_time"] or ledger.now()
                # Settle approved orders up to the batch's creation timestamp
                c = ledger.settle_orders_for_batch(
                    conn=conn,
                    platform="shopee",
                    batch_id=b["payout_id"],
                    settled_at=paid_at,
                    up_to_date=b["created_time"],
                )
                settled_count += c

    log.info(f"[payout_sync] Synced {len(batches)} batch(es), marked {settled_count} order(s) settled.")
    return {
        "ok": True,
        "batches_synced": len(batches),
        "orders_settled": settled_count,
        "batches": batches,
    }
