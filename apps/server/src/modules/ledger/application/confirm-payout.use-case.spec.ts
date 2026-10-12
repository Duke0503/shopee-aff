import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { openDatabase, type Db } from "../../../shared/database/connection";
import { campaignAwards } from "../../../shared/database/schema";
import { findOrder, markApproved, recordOrder } from "../../orders";
import { findTransfer } from "../infrastructure/payment-transfer.repository";
import { confirmPayout } from "./confirm-payout.use-case";

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
     created_at TEXT NOT NULL, created_by TEXT, notify_mode TEXT, notified_at TEXT, target_group TEXT, bill_token TEXT)`,
  `CREATE TABLE campaign_awards (id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id TEXT NOT NULL,
     customer_id TEXT NOT NULL, order_id TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL,
     created_at TEXT NOT NULL, confirmed_at TEXT, paid_at TEXT, voided_at TEXT, notified_status TEXT)`,
];

const NOW = "2026-10-07T12:00:00";

function makeDb(): Db {
  const db = openDatabase({ path: ":memory:" });
  for (const statement of DDL) db.run(sql.raw(statement));
  db.run(sql`INSERT INTO customers (customer_id, created_at) VALUES ('C1', '2026-01-01T00:00:00')`);
  return db;
}

const seedApproved = (db: Db, orderId: string, cashback: number): void => {
  recordOrder(db, {
    orderId,
    customerId: "C1",
    requestId: null,
    orderValue: 450_000,
    estimatedCommission: null,
    recordedAt: NOW,
    platform: "shopee",
    nowIso: NOW,
  });
  markApproved(db, orderId, 31_500, cashback, NOW);
};

describe("confirmPayout", () => {
  let db: Db;
  beforeEach(() => {
    db = makeDb();
  });

  it("records the transfer and marks the orders paid", () => {
    seedApproved(db, "O1", 25_200);
    const result = confirmPayout(db, {
      customerId: "C1",
      orderIds: ["O1"],
      note: "DP00012",
      transferCode: "TX1",
      nowIso: NOW,
    });
    expect(result.ok).toBe(true);
    expect(result.amountVnd).toBe(25_200);
    expect(findOrder(db, "O1")?.paidAt).toBe(NOW);
    expect(findTransfer(db, result.transferId ?? 0)?.amount).toBe(25_200);
  });

  it("adds a confirmed campaign bonus to the amount and settles it", () => {
    seedApproved(db, "O1", 6000);
    db.run(sql`INSERT INTO campaign_awards (campaign_id, customer_id, order_id, amount, status, created_at)
      VALUES ('K1', 'C1', 'O1', 20000, 'confirmed', ${NOW})`);
    const result = confirmPayout(db, {
      customerId: "C1",
      orderIds: ["O1"],
      note: "",
      transferCode: "TX1",
      nowIso: NOW,
    });
    expect(result.amountVnd).toBe(26_000);
    const award = db.select().from(campaignAwards).where(eq(campaignAwards.orderId, "O1")).get();
    expect(award?.status).toBe("paid");
    expect(award?.paidAt).toBe(NOW);
  });

  it("does not pay a bonus that is still held", () => {
    seedApproved(db, "O1", 6000);
    db.run(sql`INSERT INTO campaign_awards (campaign_id, customer_id, order_id, amount, status, created_at)
      VALUES ('K1', 'C1', 'O1', 20000, 'held', ${NOW})`);
    const result = confirmPayout(db, {
      customerId: "C1",
      orderIds: ["O1"],
      note: "",
      transferCode: "TX1",
      nowIso: NOW,
    });
    expect(result.amountVnd).toBe(6000);
  });

  it("refuses a second payout of the same order (never pay twice)", () => {
    seedApproved(db, "O1", 25_200);
    confirmPayout(db, { customerId: "C1", orderIds: ["O1"], note: "", transferCode: "TX1", nowIso: NOW });
    const second = confirmPayout(db, {
      customerId: "C1",
      orderIds: ["O1"],
      note: "",
      transferCode: "TX2",
      nowIso: NOW,
    });
    expect(second.ok).toBe(false);
  });

  it("refuses an order that is not approved yet", () => {
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
    const result = confirmPayout(db, { customerId: "C1", orderIds: ["O2"], note: "", transferCode: "T", nowIso: NOW });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not payable/);
  });
});
