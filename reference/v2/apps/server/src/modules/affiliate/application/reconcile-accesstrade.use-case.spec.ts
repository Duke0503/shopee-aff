import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { openDatabase, type Db } from "../../../shared/database/connection";
import { findOrder } from "../../orders";
import { listOpenReviews } from "../../orders/infrastructure/manual-review.repository";
import { lastRun } from "../../orders/infrastructure/reconciliation-run.repository";
import { reconcileAccessTrade } from "./reconcile-accesstrade.use-case";

const DDL = [
  `CREATE TABLE customers (customer_id TEXT PRIMARY KEY, customer_code TEXT, zalo_user_id TEXT,
     private_chat_id TEXT, display_name TEXT, bank_name TEXT, bank_account TEXT, account_holder TEXT,
     consent_at TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL,
     password_hash TEXT, password_set_at TEXT, failed_logins INTEGER NOT NULL DEFAULT 0,
     locked_until TEXT, role TEXT NOT NULL DEFAULT 'user', last_login_at TEXT,
     login_count INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE customer_aliases (alias TEXT PRIMARY KEY, customer_id TEXT NOT NULL,
     created_at TEXT NOT NULL, note TEXT)`,
  `CREATE TABLE link_requests (request_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL
     REFERENCES customers(customer_id), created_at TEXT NOT NULL, source_url TEXT NOT NULL,
     affiliate_url TEXT, estimated_commission INTEGER, channel TEXT,
     status TEXT NOT NULL DEFAULT 'pending', notified_at TEXT, estimate_source TEXT,
     estimate_detail TEXT, attempts INTEGER NOT NULL DEFAULT 0,
     platform TEXT NOT NULL DEFAULT 'shopee', share_code TEXT)`,
  `CREATE TABLE orders (order_id TEXT PRIMARY KEY, customer_id TEXT REFERENCES customers(customer_id),
     request_id TEXT, order_value INTEGER, estimated_commission INTEGER, approved_commission INTEGER,
     cashback_amount INTEGER, status TEXT NOT NULL, rejection_reason TEXT, recorded_at TEXT,
     approved_at TEXT, paid_at TEXT, updated_at TEXT NOT NULL, notified_status TEXT,
     platform TEXT NOT NULL DEFAULT 'shopee', settlement_status TEXT NOT NULL DEFAULT 'unsettled',
     payout_batch_id TEXT, settled_at TEXT)`,
  `CREATE TABLE state_history (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL,
     from_status TEXT, to_status TEXT NOT NULL, changed_at TEXT NOT NULL, note TEXT)`,
  `CREATE TABLE manual_review (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT, raw_data TEXT NOT NULL,
     reason TEXT NOT NULL, created_at TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE reconciliation_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, ran_at TEXT NOT NULL,
     source TEXT NOT NULL, period_start TEXT, period_end TEXT, rows_read INTEGER NOT NULL DEFAULT 0,
     orders_new INTEGER NOT NULL DEFAULT 0, approved INTEGER NOT NULL DEFAULT 0,
     rejected INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0,
     needs_review INTEGER NOT NULL DEFAULT 0, error TEXT)`,
];

const NOW = "2026-10-07T12:00:00";
const cashbackFor = (commission: number): number => Math.round(commission * 0.8);

const txn = (orderId: string, subs: Record<string, string>, confirmed: boolean) => ({
  transaction_id: orderId,
  merchant: "TikTok Shop",
  status: confirmed ? 1 : 0,
  is_confirmed: confirmed ? 1 : 0,
  product_price: 450_000,
  product_quantity: 1,
  commission: 31_500,
  _extra: { sub_params: subs },
});

function makeDb(): Db {
  const db = openDatabase({ path: ":memory:" });
  for (const statement of DDL) db.run(sql.raw(statement));
  db.run(sql`INSERT INTO customers (customer_id, created_at) VALUES ('8461', '2026-01-01T00:00:00')`);
  db.run(
    sql`INSERT INTO link_requests (request_id, customer_id, created_at, source_url)
        VALUES ('R1', '8461', '2026-01-01T00:00:00', 'https://www.tiktok.com/x')`,
  );
  return db;
}

const run = (db: Db, transactions: Array<Record<string, unknown>>) =>
  reconcileAccessTrade(db, { nowIso: NOW, transactions, cashbackFor });

describe("reconcileAccessTrade", () => {
  let db: Db;
  beforeEach(() => {
    db = makeDb();
  });

  it("records a new order, then approves it on a later pass when confirmed", () => {
    const first = run(db, [txn("T1", { sub1: "8461" }, true)]);
    expect(first).toMatchObject({ ordersNew: 1, approved: 0 });
    expect(findOrder(db, "T1")?.status).toBe("awaiting_approval");

    const second = run(db, [txn("T1", { sub1: "8461" }, true)]);
    expect(second.approved).toBe(1);
    expect(findOrder(db, "T1")).toMatchObject({
      status: "approved",
      approvedCommission: 31_500,
      cashbackAmount: 25_200,
      customerId: "8461",
    });
  });

  it("never pays from an estimate", () => {
    const summary = run(db, [txn("T2", { sub1: "8461" }, false)]);

    expect(summary).toMatchObject({ ordersNew: 1, approved: 0 });
    expect(findOrder(db, "T2")).toMatchObject({
      status: "awaiting_approval",
      estimatedCommission: 31_500,
      cashbackAmount: null,
    });
  });

  it("attributes through sub_id2 when sub_id1 is unknown", () => {
    const summary = run(db, [txn("T3", { sub2: "R1" }, true)]);
    expect(summary.ordersNew).toBe(1);
    expect(findOrder(db, "T3")?.customerId).toBe("8461");
  });

  it("files an unmatched order for review and never guesses a customer", () => {
    const summary = run(db, [txn("T4", { sub1: "nobody" }, true)]);

    expect(summary.needsReview).toBe(1);
    expect(findOrder(db, "T4")).toBeNull();
    expect(listOpenReviews(db)).toHaveLength(1);
  });

  it("logs one run line sourced as accesstrade", () => {
    run(db, [txn("T5", { sub1: "8461" }, true)]);
    expect(lastRun(db)).toMatchObject({ source: "accesstrade", rowsRead: 1, ordersNew: 1 });
  });
});
