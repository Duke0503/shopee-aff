import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase, type Db } from "../../../shared/database/connection";
import { getUserDetail } from "./get-user-detail.use-case";

const DDL = [
  `CREATE TABLE customers (customer_id TEXT PRIMARY KEY, customer_code TEXT, zalo_user_id TEXT,
     private_chat_id TEXT, display_name TEXT, bank_name TEXT, bank_account TEXT, account_holder TEXT,
     consent_at TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL,
     password_hash TEXT, password_set_at TEXT, failed_logins INTEGER NOT NULL DEFAULT 0,
     locked_until TEXT, role TEXT NOT NULL DEFAULT 'user', last_login_at TEXT,
     login_count INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE link_requests (request_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL,
     created_at TEXT NOT NULL, source_url TEXT NOT NULL, affiliate_url TEXT, estimated_commission INTEGER,
     channel TEXT, status TEXT NOT NULL DEFAULT 'pending', notified_at TEXT, estimate_source TEXT,
     estimate_detail TEXT, attempts INTEGER NOT NULL DEFAULT 0, platform TEXT NOT NULL DEFAULT 'shopee',
     share_code TEXT)`,
  `CREATE TABLE orders (order_id TEXT PRIMARY KEY, customer_id TEXT, request_id TEXT, order_value INTEGER,
     estimated_commission INTEGER, approved_commission INTEGER, cashback_amount INTEGER,
     status TEXT NOT NULL, rejection_reason TEXT, recorded_at TEXT, approved_at TEXT, paid_at TEXT,
     updated_at TEXT NOT NULL, notified_status TEXT, platform TEXT NOT NULL DEFAULT 'shopee',
     settlement_status TEXT NOT NULL DEFAULT 'unsettled', payout_batch_id TEXT, settled_at TEXT)`,
  `CREATE TABLE payment_transfers (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id TEXT NOT NULL,
     amount INTEGER NOT NULL, transfer_code TEXT, note TEXT, proof_image TEXT, order_ids TEXT,
     created_at TEXT NOT NULL, created_by TEXT, notify_mode TEXT, notified_at TEXT, target_group TEXT,
     bill_token TEXT)`,
  `CREATE TABLE campaign_awards (id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id TEXT NOT NULL,
     customer_id TEXT NOT NULL, order_id TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL,
     created_at TEXT NOT NULL, confirmed_at TEXT, paid_at TEXT, voided_at TEXT, notified_status TEXT)`,
  `CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id TEXT, action TEXT NOT NULL,
     path TEXT, ip_address TEXT, user_agent TEXT, detail TEXT, created_at TEXT NOT NULL)`,
];

const ORIGINAL_WITHHELD = process.env.PAYOUT_PERIOD_WITHHELD;

afterEach(() => {
  if (ORIGINAL_WITHHELD === undefined) delete process.env.PAYOUT_PERIOD_WITHHELD;
  else process.env.PAYOUT_PERIOD_WITHHELD = ORIGINAL_WITHHELD;
});

function makeDb(): Db {
  const db = openDatabase({ path: ":memory:" });
  for (const statement of DDL) db.run(sql.raw(statement));
  return db;
}

function seedCustomer(db: Db, customerId: string, role = "user"): void {
  db.run(sql`INSERT INTO customers (customer_id, customer_code, display_name, zalo_user_id, bank_name,
      bank_account, account_holder, role, created_at, last_login_at, login_count)
    VALUES (${customerId}, ${`DP${customerId}`}, ${`Ten ${customerId}`}, ${`zalo-${customerId}`},
      'Vietcombank', '0123456789', 'NGUYEN VAN A', ${role}, '2026-01-01T00:00:00',
      '2026-10-05T09:00:00', 3)`);
}

/** An order approved at 31,500 commission, saved cashback 24,953. */
function seedApprovedOrder(db: Db, customerId: string): void {
  db.run(sql`INSERT INTO orders (order_id, customer_id, request_id, order_value, estimated_commission,
      approved_commission, cashback_amount, status, recorded_at, approved_at, updated_at, platform,
      settlement_status)
    VALUES ('O1', ${customerId}, 'R1', 450000, 31500, 31500, 24953, 'approved',
      '2026-10-01T08:00:00', '2026-10-02T08:00:00', '2026-10-02T08:00:00', 'shopee', 'settled')`);
}

/** A waiting order: only an estimate of 50,000 commission exists. */
function seedWaitingOrder(db: Db, customerId: string): void {
  db.run(sql`INSERT INTO orders (order_id, customer_id, request_id, order_value, estimated_commission,
      status, recorded_at, updated_at, platform)
    VALUES ('O2', ${customerId}, NULL, 700000, 50000, 'awaiting_approval', '2026-10-03T08:00:00',
      '2026-10-03T08:00:00', 'shopee')`);
}

function seedRequest(db: Db, customerId: string): void {
  db.run(sql`INSERT INTO link_requests (request_id, customer_id, created_at, source_url, affiliate_url,
      estimated_commission, platform, estimate_detail)
    VALUES ('R1', ${customerId}, '2026-09-30T07:00:00', 'https://shopee.vn/ao-i.1.2',
      'https://shope.ee/abc', 31500, 'shopee', '{"name":"Ao thun nam"}')`);
}

describe("getUserDetail", () => {
  let db: Db;
  beforeEach(() => {
    db = makeDb();
  });

  it("answers nothing for a customer we do not have", () => {
    expect(getUserDetail(db, "NOPE")).toBeNull();
  });

  it("brings the customer, their orders, links, transfers and totals together", () => {
    seedCustomer(db, "C1");
    seedApprovedOrder(db, "C1");
    seedWaitingOrder(db, "C1");
    seedRequest(db, "C1");
    db.run(sql`INSERT INTO payment_transfers (customer_id, amount, transfer_code, note, order_ids,
        created_at, created_by, bill_token, proof_image)
      VALUES ('C1', 20000, 'TX1', 'DPC1', 'O1', '2026-10-04T09:00:00', 'admin', 'tok-1',
        '/uploads/proofs/p.jpg')`);

    const detail = getUserDetail(db, "C1");

    expect(detail?.user).toMatchObject({
      customerId: "C1",
      customerCode: "DPC1",
      displayName: "Ten C1",
      bankName: "Vietcombank",
      bankAccount: "0123456789",
      role: "user",
      loginCount: 3,
      lastBotActivity: "2026-09-30T07:00:00",
    });
    expect(detail?.stats).toEqual({
      totalCashbackVnd: 60_561, // 24,953 approved + 35,608 estimated
      readyVnd: 24_953,
      awaitingVnd: 35_608,
      paidVnd: 0,
      totalOrders: 2,
      totalRequests: 1,
      totalTransferredVnd: 20_000,
      totalAdminProfitVnd: 15_140, // 6,238 approved + 8,902 estimated
      periodIsWithheld: false,
    });
    expect(detail?.linkRequests[0]).toMatchObject({
      requestId: "R1",
      productName: "Ao thun nam",
      estimatedCommissionVnd: 31_500,
    });
    expect(detail?.transfers[0]).toMatchObject({
      amountVnd: 20_000,
      createdBy: "admin",
      orderIds: ["O1"],
      billPath: "/b/tok-1",
      proofPath: "/api/proofs/tok-1",
    });
  });

  it("explains each order with the split behind its amount", () => {
    seedCustomer(db, "C1");
    seedApprovedOrder(db, "C1");
    seedWaitingOrder(db, "C1");
    seedRequest(db, "C1");

    const orders = getUserDetail(db, "C1")?.orders ?? [];
    const approved = orders.find((order) => order.orderId === "O1");
    const waiting = orders.find((order) => order.orderId === "O2");

    expect(approved).toMatchObject({
      productName: "Ao thun nam",
      sourceUrl: "https://shopee.vn/ao-i.1.2",
      cashbackVnd: 24_953,
      settlementStatus: "settled",
      breakdown: {
        basis: "approved",
        commissionVnd: 31_500,
        serviceFeeVnd: 309,
        withheldTaxVnd: 0,
        netVnd: 31_191,
        cashbackVnd: 24_953,
        operatorKeepsVnd: 6_238,
      },
    });
    // Nothing is approved yet, so the figures are the customer's own estimate.
    expect(waiting).toMatchObject({
      productName: "",
      cashbackVnd: 35_608,
      approvedCommissionVnd: null,
      breakdown: { basis: "estimate", withheldTaxVnd: 5000, cashbackVnd: 35_608 },
    });
  });

  it("takes the withheld tax out of the explanation, never out of money already owed", () => {
    seedCustomer(db, "C1");
    seedApprovedOrder(db, "C1");
    process.env.PAYOUT_PERIOD_WITHHELD = "true";

    const detail = getUserDetail(db, "C1");

    expect(detail?.stats.periodIsWithheld).toBe(true);
    // The saved cashback is what we owe; a change of period cannot rewrite it.
    expect(detail?.stats.readyVnd).toBe(24_953);
    expect(detail?.orders[0]?.breakdown).toMatchObject({
      basis: "approved",
      withheldTaxVnd: 3_150,
      netVnd: 28_041,
      cashbackVnd: 24_953,
      operatorKeepsVnd: 3_088,
    });
  });

  it("owes the guest account nothing", () => {
    seedCustomer(db, "HOUSE");
    seedApprovedOrder(db, "HOUSE");

    expect(getUserDetail(db, "HOUSE")?.stats).toMatchObject({
      totalCashbackVnd: 0,
      readyVnd: 0,
      awaitingVnd: 0,
      paidVnd: 0,
    });
  });

  it("counts bot activity from either a link request or a logged command", () => {
    seedCustomer(db, "C1");
    seedRequest(db, "C1");
    db.run(sql`INSERT INTO activity_logs (customer_id, action, created_at)
      VALUES ('zalo-C1', 'link_created', '2026-10-05T11:00:00')`);

    expect(getUserDetail(db, "C1")?.user.lastBotActivity).toBe("2026-10-05T11:00:00");
  });
});
