import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { openDatabase, type Db } from "../../../shared/database/connection";
import { computeBalanceFor } from "./balance.repository";
import { collectPayablesFromDb } from "./payables.repository";

const DDL = [
  `CREATE TABLE customers (customer_id TEXT PRIMARY KEY, bank_account TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE orders (order_id TEXT PRIMARY KEY, customer_id TEXT, request_id TEXT, order_value INTEGER,
     estimated_commission INTEGER, approved_commission INTEGER, cashback_amount INTEGER, status TEXT NOT NULL,
     rejection_reason TEXT, recorded_at TEXT, approved_at TEXT, paid_at TEXT, updated_at TEXT NOT NULL,
     notified_status TEXT, platform TEXT NOT NULL DEFAULT 'shopee',
     settlement_status TEXT NOT NULL DEFAULT 'unsettled', payout_batch_id TEXT, settled_at TEXT)`,
  `CREATE TABLE campaign_awards (id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id TEXT NOT NULL,
     customer_id TEXT NOT NULL, order_id TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL,
     created_at TEXT NOT NULL, confirmed_at TEXT, paid_at TEXT, voided_at TEXT, notified_status TEXT)`,
];

const NOW = "2026-10-07T12:00:00";

function makeDb(): Db {
  const db = openDatabase({ path: ":memory:" });
  for (const statement of DDL) db.run(sql.raw(statement));
  db.run(sql`INSERT INTO customers (customer_id, bank_account, created_at) VALUES
    ('C1', '123', '2026-01-01T00:00:00'),
    ('C2', NULL, '2026-01-01T00:00:00'),
    ('C3', '999', '2026-01-01T00:00:00')`);
  db.run(sql`INSERT INTO orders (order_id, customer_id, cashback_amount, estimated_commission, status, paid_at, updated_at) VALUES
    ('O1', 'C1', 6000, NULL, 'approved', NULL, ${NOW}),
    ('O2', 'C2', 9000, NULL, 'approved', NULL, ${NOW}),
    ('O3', 'C1', 5000, NULL, 'paid', '2026-10-01T00:00:00', ${NOW}),
    ('O4', 'C1', NULL, 10000, 'awaiting_approval', NULL, ${NOW}),
    ('O5', 'C3', 4000, NULL, 'approved', NULL, ${NOW})`);
  db.run(sql`INSERT INTO campaign_awards (campaign_id, customer_id, order_id, amount, status, created_at) VALUES
    ('K1', 'C1', 'O1', 20000, 'confirmed', ${NOW}),
    ('K1', 'C1', 'O3', 3000, 'paid', ${NOW}),
    ('K1', 'C1', 'O4', 20000, 'held', ${NOW}),
    ('K1', 'C3', 'O5', 20000, 'void', ${NOW})`);
  return db;
}

describe("collectPayablesFromDb with campaign bonuses", () => {
  let db: Db;
  beforeEach(() => {
    db = makeDb();
  });

  it("adds confirmed bonuses to the payable, and ignores held or void ones", () => {
    const { ready, blocked } = collectPayablesFromDb(db, NOW);

    expect(ready).toEqual([
      { customerId: "C1", amountVnd: 26000, blockedReason: null, bankChangedRecently: false },
      { customerId: "C3", amountVnd: 4000, blockedReason: null, bankChangedRecently: false },
    ]);
    expect(blocked.map((payable) => payable.customerId)).toEqual(["C2"]);
    expect(blocked[0]?.amountVnd).toBe(9000);
  });
});

describe("computeBalanceFor with campaign bonuses", () => {
  let db: Db;
  beforeEach(() => {
    db = makeDb();
  });

  it("places each bonus in its bucket: confirmed ready, held awaiting, paid paid", () => {
    expect(computeBalanceFor(db, "C1")).toEqual({
      approvedWaitingVnd: 26000,
      stillWithShopVnd: 27122,
      alreadyPaidVnd: 8000,
    });
  });

  it("owes the guest account nothing", () => {
    expect(computeBalanceFor(db, "HOUSE")).toEqual({
      approvedWaitingVnd: 0,
      stillWithShopVnd: 0,
      alreadyPaidVnd: 0,
    });
  });
});
