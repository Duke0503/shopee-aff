import sqlite3
import sys

sys.stdout.reconfigure(encoding='utf-8')

def recalibrate():
    db_path = "cashback.db"
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    rows = conn.execute("SELECT item_id, name, request_count FROM products_cache").fetchall()
    print(f"Recalibrating request_count for {len(rows)} products in {db_path}...")

    updated_count = 0
    for r in rows:
        item_id = r["item_id"]
        name = (r["name"] or "")[:20]
        old_count = r["request_count"] or 0

        # Query matching link_requests
        real_cnt = conn.execute("""
            SELECT COUNT(r.request_id)
            FROM link_requests r
            WHERE r.source_url LIKE ? OR r.estimate_detail LIKE ? OR (? != '' AND r.estimate_detail LIKE ?)
        """, (f"%{item_id}%", f"%{item_id}%", name, f"%{name}%")).fetchone()[0]

        if real_cnt != old_count:
            conn.execute("UPDATE products_cache SET request_count = ? WHERE item_id = ?", (real_cnt, item_id))
            print(f"  [{item_id}] {r['name'][:30]}: {old_count} -> {real_cnt}")
            updated_count += 1
        else:
            print(f"  [{item_id}] {r['name'][:30]}: unchanged ({real_cnt})")

    conn.commit()
    conn.close()
    print(f"\nDone! Recalibrated {updated_count} products.")

if __name__ == "__main__":
    recalibrate()
