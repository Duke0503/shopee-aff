import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import type { AccessTradeTransaction } from "../modules/affiliate/domain/accesstrade-order";
import type { AccessTradeOrdersPort } from "../modules/affiliate/providers/accesstrade.client";
import { findOrder } from "../modules/orders";
import { lastRun } from "../modules/orders/infrastructure/reconciliation-run.repository";
import { openDatabase, type Db } from "../shared/database/connection";
import { createAccessTradeReconcileJob } from "./reconcile-accesstrade.job";

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
     source TEXT NOT NULL, period_start TEXT, period_end TEXT,
     rows_read INTEGER NOT NULL DEFAULT 0, orders_new INTEGER NOT NULL DEFAULT 0,
     approved INTEGER NOT NULL DEFAULT 0, rejected INTEGER NOT NULL DEFAULT 0,
     skipped INTEGER NOT NULL DEFAULT 0, needs_review INTEGER NOT NULL DEFAULT 0, error TEXT)`,
];

const NOW = "2026-10-07T12:00:00";

class FakeOrders implements AccessTradeOrdersPort {
  readonly calls: number[] = [];

  constructor(private readonly rows: AccessTradeTransaction[]) {}

  async fetchTransactions(sinceDays = 30): Promise<AccessTradeTransaction[]> {
    this.calls.push(sinceDays);
    return this.rows;
  }
}

const confirmed = (orderId: string): AccessTradeTransaction => ({
  transaction_id: orderId,
  merchant: "TikTok Shop",
  status: 1,
  is_confirmed: 1,
  product_price: 450_000,
  product_quantity: 1,
  commission: 31_500,
  _extra: { sub_params: { sub1: "8461" } },
});

function makeDb(): Db {
  const db = openDatabase({ path: ":memory:" });
  for (const statement of DDL) db.run(sql.raw(statement));
  db.run(sql`INSERT INTO customers (customer_id, created_at) VALUES ('8461', '2026-01-01T00:00:00')`);
  return db;
}

const makeJob = (db: Db, orders: AccessTradeOrdersPort) =>
  createAccessTradeReconcileJob({ db, orders, now: () => NOW, intervalMs: 1, cashbackRate: 0.8 });

describe("createAccessTradeReconcileJob", () => {
  let db: Db;
  beforeEach(() => {
    db = makeDb();
  });

  it("records on one pass, then approves with the shared money split", async () => {
    const orders = new FakeOrders([confirmed("T1")]);
    const job = makeJob(db, orders);

    await job.run();
    expect(findOrder(db, "T1")?.status).toBe("awaiting_approval");

    await job.run();
    // 31,500 commission: fee 309 -> net 31,191 -> 80% = 24,953 (half up).
    expect(findOrder(db, "T1")).toMatchObject({ status: "approved", cashbackAmount: 24_953 });
    expect(orders.calls).toEqual([30, 30]);
    expect(lastRun(db)?.source).toBe("accesstrade");
  });

  it("does nothing when the report is empty", async () => {
    await makeJob(db, new FakeOrders([])).run();
    expect(lastRun(db)).toBeNull();
  });

  it("withholds the 10% when the payout period is withheld", async () => {
    const original = process.env.PAYOUT_PERIOD_WITHHELD;
    process.env.PAYOUT_PERIOD_WITHHELD = "true";
    try {
      const job = makeJob(db, new FakeOrders([confirmed("T1")]));
      await job.run();
      await job.run();
    } finally {
      if (original === undefined) delete process.env.PAYOUT_PERIOD_WITHHELD;
      else process.env.PAYOUT_PERIOD_WITHHELD = original;
    }

    // 31,500 commission: fee 309, tax 3,150 -> net 28,041 -> 80% = 22,432.8 (half up).
    expect(findOrder(db, "T1")).toMatchObject({ status: "approved", cashbackAmount: 22_433 });
  });
});
