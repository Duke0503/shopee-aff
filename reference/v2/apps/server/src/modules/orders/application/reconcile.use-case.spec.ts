import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { openDatabase, type Db } from "../../../shared/database/connection";
import type { AttributionLookups } from "../domain/attribution";
import { findOrder, markApproved, markPaid, recordOrder } from "../infrastructure/order.repository";
import { listOpenReviews } from "../infrastructure/manual-review.repository";
import { lastRun } from "../infrastructure/reconciliation-run.repository";
import { reconcileReport, type ReportRowInput } from "./reconcile.use-case";

const DDL = [
  `CREATE TABLE customers (customer_id TEXT PRIMARY KEY, created_at TEXT NOT NULL,
     customer_code TEXT, zalo_user_id TEXT, display_name TEXT, private_chat_id TEXT,
     bank_name TEXT, bank_account TEXT, account_holder TEXT, consent_at TEXT,
     status TEXT NOT NULL DEFAULT 'active', password_hash TEXT, password_set_at TEXT,
     failed_logins INTEGER NOT NULL DEFAULT 0, locked_until TEXT,
     role TEXT NOT NULL DEFAULT 'user', last_login_at TEXT, login_count INTEGER NOT NULL DEFAULT 0)`,
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
const CASHBACK_RATE = 0.8;
const lookups: AttributionLookups = {
  findCustomer: (id) => (id === "8461" ? "8461" : null),
  requestOwner: (id) => (id === "R1" ? "8461" : null),
};
const cashbackFor = (commission: number): number => Math.round(commission * CASHBACK_RATE);

const row = (
  orderId: string,
  status: ReportRowInput["status"],
  subId1: string | null,
  subId2: string | null = null,
  approvedCommission: number | null = null,
): ReportRowInput => ({
  orderId,
  subId1,
  subId2,
  status,
  approvedCommission,
  orderValueVnd: 450_000,
  recordedAt: "2026-10-05T09:00:00",
  platform: "shopee",
});

function makeDb(): Db {
  const db = openDatabase({ path: ":memory:" });
  for (const statement of DDL) db.run(sql.raw(statement));
  db.run(sql`INSERT INTO customers (customer_id, created_at) VALUES ('8461', '2026-01-01T00:00:00')`);
  db.run(
    sql`INSERT INTO link_requests (request_id, customer_id, created_at, source_url)
        VALUES ('R1', '8461', '2026-01-01T00:00:00', 'https://shopee.vn/x')`,
  );
  return db;
}

const run = (db: Db, rows: ReportRowInput[], nowIso = NOW) =>
  reconcileReport(db, { source: "shopee", nowIso, rows, lookups, cashbackFor });

describe("reconcileReport", () => {
  let db: Db;
  beforeEach(() => {
    db = makeDb();
  });

  it("records a new order, then approves it on a later pass", () => {
    const first = run(db, [row("O1", "awaiting_approval", "8461")]);
    expect(first.ordersNew).toBe(1);
    expect(findOrder(db, "O1")?.status).toBe("awaiting_approval");

    const second = run(db, [row("O1", "approved", "8461", null, 31_500)]);
    expect(second.approved).toBe(1);
    expect(findOrder(db, "O1")?.status).toBe("approved");
    expect(findOrder(db, "O1")?.cashbackAmount).toBe(25_200);
  });

  it("attributes through sub_id2 when sub_id1 is unknown", () => {
    const summary = run(db, [row("O2", "awaiting_approval", "nobody", "R1")]);
    expect(summary.ordersNew).toBe(1);
    expect(findOrder(db, "O2")?.customerId).toBe("8461");
  });

  it("files an unmatched order for review, only once", () => {
    expect(run(db, [row("OX", "awaiting_approval", "nobody", "nowhere")]).needsReview).toBe(1);
    expect(run(db, [row("OX", "awaiting_approval", "nobody", "nowhere")]).needsReview).toBe(0);
    expect(listOpenReviews(db)).toHaveLength(1);
  });

  it("never touches an order that is already paid", () => {
    recordOrder(db, {
      orderId: "O3",
      customerId: "8461",
      requestId: "R1",
      orderValue: 450_000,
      estimatedCommission: 30_000,
      recordedAt: NOW,
      platform: "shopee",
      nowIso: NOW,
    });
    markApproved(db, "O3", 31_500, 25_200, NOW);
    markPaid(db, "O3", NOW);

    const summary = run(db, [row("O3", "rejected", "8461")]);
    expect(summary.skipped).toBe(1);
    expect(findOrder(db, "O3")?.status).toBe("paid");
  });

  it("logs one run line with the counts", () => {
    run(db, [row("O1", "awaiting_approval", "8461")]);
    const logged = lastRun(db);
    expect(logged?.rowsRead).toBe(1);
    expect(logged?.ordersNew).toBe(1);
  });
});
