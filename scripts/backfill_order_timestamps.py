"""Backfill and correct order recorded_at timestamps in cashback.db.

Uses official timestamps from:
1. AccessTrade API transaction_time
2. Shopee report raw purchase_time (from manual_review table)
3. Corresponding link_requests timestamp if placed on the same day
4. Order SN prefix YYMMDD
"""

import os
import sys
import shutil
import sqlite3
import json
from datetime import datetime

# Add project root to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.cashback.ledger.repository import parse_order_time, now
from src.cashback.core.config import load
from src.cashback.providers.accesstrade_reconciler import fetch_accesstrade_transactions

def run_backfill(db_path: str = "cashback.db") -> None:
    if not os.path.exists(db_path):
        print(f"Database {db_path} does not exist.")
        return

    # Create backup first
    backup_file = f"{db_path}.bak_timestamps_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    shutil.copy2(db_path, backup_file)
    print(f"Created database backup at: {backup_file}")

    cfg = load()
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    # Fetch AccessTrade transaction times if available
    at_times = {}
    if cfg.accesstrade_api_key:
        try:
            txs = fetch_accesstrade_transactions(api_key=cfg.accesstrade_api_key, since_days=60)
            for t in txs:
                oid = str(t.get("transaction_id") or t.get("order_id") or "")
                ttime = t.get("transaction_time") or t.get("created_time")
                if oid and ttime:
                    at_times[oid] = ttime
        except Exception as e:
            print("Warning: Failed to fetch AccessTrade transactions:", e)

    # Fetch raw times from manual_review
    manual_reviews = conn.execute("SELECT order_id, raw_data FROM manual_review").fetchall()
    raw_times = {}
    for r in manual_reviews:
        try:
            raw_obj = json.loads(r["raw_data"])
            if isinstance(raw_obj, dict):
                pt = raw_obj.get("purchase_time") or raw_obj.get("order_time")
                if pt:
                    raw_times[r["order_id"]] = pt
        except Exception:
            pass

    # Fetch link_requests created_at
    link_requests = conn.execute("SELECT request_id, created_at FROM link_requests").fetchall()
    lr_map = {r["request_id"]: r["created_at"] for r in link_requests if r["request_id"]}

    orders = conn.execute("SELECT order_id, platform, request_id, recorded_at FROM orders").fetchall()
    print(f"Processing {len(orders)} orders...")

    updated_count = 0
    for o in orders:
        oid = o["order_id"]
        current_rec = o["recorded_at"]
        req_id = o["request_id"]
        lr_time = lr_map.get(req_id)

        new_time = None
        source = ""
        if oid in at_times:
            new_time = parse_order_time(at_times[oid], order_id=oid)
            source = "AccessTrade API"
        elif oid in raw_times:
            new_time = parse_order_time(raw_times[oid], order_id=oid)
            source = "Shopee raw purchase_time"
        elif lr_time and lr_time[:10].replace("-", "")[2:] == oid[:6]:
            new_time = parse_order_time(lr_time, order_id=oid)
            source = "link_requests.created_at"
        elif current_rec and current_rec[:10].replace("-", "")[2:] == oid[:6]:
            new_time = current_rec
            source = "current recorded_at (already correct date)"
        else:
            new_time = parse_order_time("", order_id=oid)
            source = "order_sn prefix"

        if new_time and new_time != current_rec:
            conn.execute(
                "UPDATE orders SET recorded_at = ?, updated_at = ? WHERE order_id = ?",
                (new_time, now(), oid),
            )
            print(f"Updated {oid}: {current_rec} -> {new_time} ({source})")
            updated_count += 1
        else:
            print(f"Unchanged {oid}: {current_rec} ({source})")

    conn.commit()
    conn.close()
    print(f"Backfill complete! Updated {updated_count}/{len(orders)} orders.")

if __name__ == "__main__":
    run_backfill()
