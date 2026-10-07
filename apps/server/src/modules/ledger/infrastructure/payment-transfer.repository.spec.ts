import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { openDatabase, type Db } from "../../../shared/database/connection";
import {
  decodeOrderIds,
  findTransfer,
  listTransfersForCustomer,
  recordTransfer,
} from "./payment-transfer.repository";

const DDL = `
CREATE TABLE payment_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id TEXT NOT NULL, amount INTEGER NOT NULL,
  transfer_code TEXT, note TEXT, proof_image TEXT, order_ids TEXT, created_at TEXT NOT NULL,
  created_by TEXT, notify_mode TEXT, notified_at TEXT, target_group TEXT)`;

const NOW = "2026-10-07T12:00:00";

function makeDb(): Db {
  const db = openDatabase({ path: ":memory:" });
  db.run(sql.raw(DDL));
  return db;
}

describe("payment-transfer repository", () => {
  let db: Db;
  beforeEach(() => {
    db = makeDb();
  });

  it("records a transfer and reads it back with its orders", () => {
    const id = recordTransfer(db, {
      customerId: "C1",
      amountVnd: 39_608,
      orderIds: ["O1", "O2"],
      note: "DP00012 HD123",
      transferCode: "TX1",
      createdAt: NOW,
    });
    const row = findTransfer(db, id);
    expect(row?.amount).toBe(39_608);
    expect(decodeOrderIds(row?.orderIds ?? null)).toEqual(["O1", "O2"]);
  });

  it("lists a customer's transfers, newest first", () => {
    recordTransfer(db, { customerId: "C1", amountVnd: 1000, orderIds: [], note: "", transferCode: "a", createdAt: "2026-10-01T00:00:00" });
    recordTransfer(db, { customerId: "C1", amountVnd: 2000, orderIds: [], note: "", transferCode: "b", createdAt: "2026-10-05T00:00:00" });
    recordTransfer(db, { customerId: "C2", amountVnd: 3000, orderIds: [], note: "", transferCode: "c", createdAt: "2026-10-06T00:00:00" });

    expect(listTransfersForCustomer(db, "C1").map((t) => t.amount)).toEqual([2000, 1000]);
  });
});
