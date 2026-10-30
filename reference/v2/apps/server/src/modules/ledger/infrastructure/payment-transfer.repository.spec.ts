import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { openDatabase, type Db } from "../../../shared/database/connection";
import {
  decodeOrderIds,
  findTransfer,
  findTransferByBillToken,
  listTransfersForCustomer,
  recordTransfer,
  totalReceivedUpTo,
} from "./payment-transfer.repository";

const DDL = `
CREATE TABLE payment_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id TEXT NOT NULL, amount INTEGER NOT NULL,
  transfer_code TEXT, note TEXT, proof_image TEXT, order_ids TEXT, created_at TEXT NOT NULL,
  created_by TEXT, notify_mode TEXT, notified_at TEXT, target_group TEXT, bill_token TEXT)`;

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

  it("gives every new transfer an unguessable bill token to find it by", () => {
    const first = recordTransfer(db, {
      customerId: "C1",
      amountVnd: 1000,
      orderIds: [],
      note: "",
      transferCode: "a",
      createdAt: NOW,
    });
    const second = recordTransfer(db, {
      customerId: "C2",
      amountVnd: 2000,
      orderIds: [],
      note: "",
      transferCode: "b",
      createdAt: NOW,
    });

    const token = findTransfer(db, first)?.billToken ?? "";
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(findTransfer(db, second)?.billToken).not.toBe(token);
    expect(findTransferByBillToken(db, token)?.id).toBe(first);
    expect(findTransferByBillToken(db, "nope")).toBeNull();
    expect(findTransferByBillToken(db, "")).toBeNull();
  });

  it("totals what a customer has received up to one transfer", () => {
    const first = recordTransfer(db, { customerId: "C1", amountVnd: 1000, orderIds: [], note: "", transferCode: "a", createdAt: "2026-10-01T00:00:00" });
    recordTransfer(db, { customerId: "C2", amountVnd: 5000, orderIds: [], note: "", transferCode: "b", createdAt: "2026-10-02T00:00:00" });
    const third = recordTransfer(db, { customerId: "C1", amountVnd: 2000, orderIds: [], note: "", transferCode: "c", createdAt: "2026-10-03T00:00:00" });

    expect(totalReceivedUpTo(db, "C1", first)).toBe(1000);
    expect(totalReceivedUpTo(db, "C1", third)).toBe(3000);
    expect(totalReceivedUpTo(db, "C3", third)).toBe(0);
  });
});
