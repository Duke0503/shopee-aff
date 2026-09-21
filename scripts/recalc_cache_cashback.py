import sqlite3

def vnd(val):
    return f"{int(val):,}đ".replace(",", ".")

conn = sqlite3.connect("cashback.db")
conn.row_factory = sqlite3.Row
rows = conn.execute("SELECT item_id, total_commission FROM products_cache WHERE total_commission > 0").fetchall()
count = 0
for r in rows:
    raw = r["total_commission"] or 0
    net = int(round(raw * (1 - 0.10 - 0.0098)))
    cb = int(round(net * 0.80))
    cb_fmt = vnd(cb)
    conn.execute(
        "UPDATE products_cache SET cashback = ?, cashback_formatted = ? WHERE item_id = ?",
        (cb, cb_fmt, r["item_id"])
    )
    count += 1
conn.commit()
print(f"Successfully updated {count} products in products_cache to 80% of net received!")
conn.close()
