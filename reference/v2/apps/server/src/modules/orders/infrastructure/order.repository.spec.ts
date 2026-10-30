import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { openDatabase, type Db } from "../../../shared/database/connection";
import {
  findOrder,
  listOrderHistory,
  markApproved,
  markPaid,
  markRejected,
  recordOrder,
} from "./order.repository";

const DDL = [
  `CREATE TABLE customers (customer_id TEXT PRIMARY KEY, customer_code TEXT, zalo_user_id TEXT,
     display_name TEXT, private_chat_id TEXT, bank_name TEXT, bank_account TEXT, account_holder TEXT,
     consent_at TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL,
     password_hash TEXT, password_set_at TEXT, failed_logins INTEGER NOT NULL DEFAULT 0,
     locked_until TEXT, role TEXT NOT NULL DEFAULT 'user', last_login_at TEXT,
     login_count INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE link_requests (request_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL
     REFERENCES customers(customer_id), created_at TEXT NOT NULL, source_url TEXT NOT NULL,
     affiliate_url TEXT, status TEXT NOT NULL DEFAULT 'pending')`,
  `CREATE TABLE orders (order_id TEXT PRIMARY KEY, customer_id TEXT REFERENCES customers(customer_id),
     request_id TEXT REFERENCES link_requests(request_id), order_value INTEGER,
     estimated_commission INTEGER, approved_commission INTEGER, cashback_amount INTEGER,
     status TEXT NOT NULL, rejection_reason TEXT, recorded_at TEXT, approved_at TEXT, paid_at TEXT,
     updated_at TEXT NOT NULL, notified_status TEXT, platform TEXT NOT NULL DEFAULT 'shopee',
     settlement_status TEXT NOT NULL DEFAULT 'unsettled', payout_batch_id TEXT, settled_at TEXT)`,
  `CREATE TABLE state_history (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL,
     from_status TEXT, to_status TEXT NOT NULL, changed_at TEXT NOT NULL, note TEXT)`,
];

const NOW = "2026-10-07T12:00:00";
const NEW_ORDER = {
  orderId: "O1",
  customerId: "C1",
  requestId: "R1",
  orderValue: 450_000,
  estimatedCommission: 30_000,
  recordedAt: "2026-10-05T09:00:00",
  platform: "shopee",
  nowIso: NOW,
};

function makeDb(): Db {
  const db = openDatabase({ path: ":memory:" });
  for (const statement of DDL) db.run(sql.raw(statement));
  db.run(sql`INSERT INTO customers (customer_id, created_at) VALUES ('C1', '2026-01-01T00:00:00')`);
  db.run(
    sql`INSERT INTO link_requests (request_id, customer_id, created_at, source_url)
        VALUES ('R1', 'C1', '2026-01-01T00:00:00', 'https://shopee.vn/x')`,
  );
  return db;
}

describe("order repository", () => {
  let db: Db;
  beforeEach(() => {
    db = makeDb();
  });

  it("records a new order as awaiting_approval with a history line", () => {
    recordOrder(db, NEW_ORDER);
    expect(findOrder(db, "O1")?.status).toBe("awaiting_approval");
    expect(listOrderHistory(db, "O1")).toHaveLength(1);
  });

  it("approves a waiting order and stores the cashback", () => {
    recordOrder(db, NEW_ORDER);
    markApproved(db, "O1", 31_500, 24_696, NOW);
    const order = findOrder(db, "O1");
    expect(order?.status).toBe("approved");
    expect(order?.cashbackAmount).toBe(24_696);
    expect(listOrderHistory(db, "O1").map((h) => h.toStatus)).toEqual([
      "awaiting_approval",
      "approved",
    ]);
  });

  it("marks an approved order paid, and a second call does nothing", () => {
    recordOrder(db, NEW_ORDER);
    markApproved(db, "O1", 31_500, 24_696, NOW);
    markPaid(db, "O1", NOW);
    expect(findOrder(db, "O1")?.paidAt).toBe(NOW);
    const before = listOrderHistory(db, "O1").length;

    markPaid(db, "O1", NOW);
    expect(listOrderHistory(db, "O1")).toHaveLength(before); // no second "paid" line
  });

  it("refuses to mark a waiting order paid", () => {
    recordOrder(db, NEW_ORDER);
    expect(() => markPaid(db, "O1", NOW)).toThrow(/not approved/);
  });

  it("rejects a waiting order but never an approved one", () => {
    recordOrder(db, NEW_ORDER);
    markRejected(db, "O1", "cancelled", NOW);
    expect(findOrder(db, "O1")?.status).toBe("rejected");

    const other = makeDb();
    recordOrder(other, { ...NEW_ORDER, orderId: "O2" });
    markApproved(other, "O2", 1000, 800, NOW);
    expect(() => markRejected(other, "O2", "cancelled", NOW)).toThrow(/cannot reject/);
  });
});
