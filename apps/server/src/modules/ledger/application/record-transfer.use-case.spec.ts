import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { openDatabase, type Db } from "../../../shared/database/connection";
import { findOrder, markApproved, recordOrder } from "../../orders";
import {
  findTransfer,
  findTransferByBillToken,
  listTransfers,
} from "../infrastructure/payment-transfer.repository";
import { recordTransferForCustomer } from "./record-transfer.use-case";

const DDL = [
  `CREATE TABLE customers (customer_id TEXT PRIMARY KEY, created_at TEXT NOT NULL)`,
  `CREATE TABLE orders (order_id TEXT PRIMARY KEY, customer_id TEXT, request_id TEXT, order_value INTEGER,
     estimated_commission INTEGER, approved_commission INTEGER, cashback_amount INTEGER, status TEXT NOT NULL,
     rejection_reason TEXT, recorded_at TEXT, approved_at TEXT, paid_at TEXT, updated_at TEXT NOT NULL,
     notified_status TEXT, platform TEXT NOT NULL DEFAULT 'shopee',
     settlement_status TEXT NOT NULL DEFAULT 'unsettled', payout_batch_id TEXT, settled_at TEXT)`,
  `CREATE TABLE state_history (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL,
     from_status TEXT, to_status TEXT NOT NULL, changed_at TEXT NOT NULL, note TEXT)`,
  `CREATE TABLE payment_transfers (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id TEXT NOT NULL,
     amount INTEGER NOT NULL, transfer_code TEXT, note TEXT, proof_image TEXT, order_ids TEXT,
     created_at TEXT NOT NULL, created_by TEXT, notify_mode TEXT, notified_at TEXT, target_group TEXT,
     bill_token TEXT)`,
  `CREATE TABLE campaign_awards (id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id TEXT NOT NULL,
     customer_id TEXT NOT NULL, order_id TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL,
     created_at TEXT NOT NULL, confirmed_at TEXT, paid_at TEXT, voided_at TEXT, notified_status TEXT)`,
];

const NOW = "2026-10-07T12:00:00";

function makeDb(): Db {
  const db = openDatabase({ path: ":memory:" });
  for (const statement of DDL) db.run(sql.raw(statement));
  db.run(sql`INSERT INTO customers (customer_id, created_at) VALUES ('C1', '2026-01-01T00:00:00')`);
  db.run(sql`INSERT INTO customers (customer_id, created_at) VALUES ('C2', '2026-01-01T00:00:00')`);
  return db;
}

const seedApproved = (db: Db, orderId: string, cashback: number, customerId = "C1"): void => {
  recordOrder(db, {
    orderId,
    customerId,
    requestId: null,
    orderValue: 450_000,
    estimatedCommission: null,
    recordedAt: NOW,
    platform: "shopee",
    nowIso: NOW,
  });
  markApproved(db, orderId, 31_500, cashback, NOW);
};

const input = (overrides: Partial<Parameters<typeof recordTransferForCustomer>[1]> = {}) => ({
  customerId: "C1",
  orderIds: [] as string[],
  expectedAmountVnd: null,
  note: "DP00012",
  transferCode: "TX1",
  proofImage: "",
  nowIso: NOW,
  ...overrides,
});

describe("recordTransferForCustomer", () => {
  let db: Db;
  beforeEach(() => {
    db = makeDb();
  });

  it("pays everything approved and unpaid when no orders are named", () => {
    seedApproved(db, "O1", 25_200);
    seedApproved(db, "O2", 10_000);
    recordOrder(db, {
      orderId: "O3",
      customerId: "C1",
      requestId: null,
      orderValue: 1,
      estimatedCommission: null,
      recordedAt: NOW,
      platform: "shopee",
      nowIso: NOW,
    });
    seedApproved(db, "OTHER", 5_000, "C2");

    const result = recordTransferForCustomer(db, input());

    expect(result.ok).toBe(true);
    expect(result.amountVnd).toBe(35_200);
    expect(findOrder(db, "O1")?.paidAt).toBe(NOW);
    expect(findOrder(db, "O2")?.paidAt).toBe(NOW);
    expect(findOrder(db, "O3")?.paidAt).toBeNull();
    expect(findOrder(db, "OTHER")?.paidAt).toBeNull();
    expect(findTransfer(db, result.transferId ?? 0)?.orderIds).toBe("O1,O2");
  });

  it("adds a confirmed campaign bonus to the computed amount", () => {
    seedApproved(db, "O1", 6000);
    db.run(sql`INSERT INTO campaign_awards (campaign_id, customer_id, order_id, amount, status, created_at)
      VALUES ('K1', 'C1', 'O1', 20000, 'confirmed', ${NOW})`);

    const result = recordTransferForCustomer(db, input());

    expect(result.amountVnd).toBe(26_000);
  });

  it("refuses an expected amount that no longer matches the orders", () => {
    seedApproved(db, "O1", 25_200);

    const result = recordTransferForCustomer(db, input({ expectedAmountVnd: 30_000 }));

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("25200");
    expect(listTransfers(db)).toHaveLength(0);
    expect(findOrder(db, "O1")?.paidAt).toBeNull();
  });

  it("accepts the amount the caller expected when it matches", () => {
    seedApproved(db, "O1", 25_200);

    const result = recordTransferForCustomer(db, input({ expectedAmountVnd: 25_200 }));

    expect(result.ok).toBe(true);
    expect(result.amountVnd).toBe(25_200);
  });

  it("refuses when the customer has nothing payable", () => {
    const result = recordTransferForCustomer(db, input());

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no approved, unpaid orders/);
    expect(listTransfers(db)).toHaveLength(0);
  });

  it("refuses an order that is not payable", () => {
    recordOrder(db, {
      orderId: "O2",
      customerId: "C1",
      requestId: null,
      orderValue: 1,
      estimatedCommission: null,
      recordedAt: NOW,
      platform: "shopee",
      nowIso: NOW,
    });

    const result = recordTransferForCustomer(db, input({ orderIds: ["O2"] }));

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not payable/);
  });

  it("returns a bill token that finds the transfer it just recorded", () => {
    seedApproved(db, "O1", 25_200);

    const result = recordTransferForCustomer(db, input({ proofImage: "/uploads/proofs/p.jpg" }));

    expect(findTransferByBillToken(db, result.billToken)?.amount).toBe(25_200);
    expect(findTransferByBillToken(db, result.billToken)?.proofImage).toBe("/uploads/proofs/p.jpg");
  });
});
