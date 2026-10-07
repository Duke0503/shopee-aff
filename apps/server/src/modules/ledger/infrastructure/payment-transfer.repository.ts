import { desc, eq } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { paymentTransfers } from "../../../shared/database/schema";

/**
 * `payment_transfers` persistence — the record of money we actually sent a
 * customer. Ports `ledger/payouts.py`.
 */
export interface NewTransfer {
  customerId: string;
  amountVnd: number;
  orderIds: string[];
  note: string;
  transferCode: string;
  createdAt: string;
}

/** Stored as one text column, comma separated (the Python keeps a text list). */
const encodeOrderIds = (ids: string[]): string => ids.join(",");
export const decodeOrderIds = (value: string | null): string[] =>
  (value ?? "").split(",").filter((id) => id !== "");

export function recordTransfer(db: Db, transfer: NewTransfer): number {
  const result = db
    .insert(paymentTransfers)
    .values({
      customerId: transfer.customerId,
      amount: transfer.amountVnd,
      orderIds: encodeOrderIds(transfer.orderIds),
      note: transfer.note,
      transferCode: transfer.transferCode,
      createdAt: transfer.createdAt,
    })
    .run();
  return Number(result.lastInsertRowid);
}

export function findTransfer(db: Db, id: number) {
  return db.select().from(paymentTransfers).where(eq(paymentTransfers.id, id)).get() ?? null;
}

export function listTransfersForCustomer(db: Db, customerId: string) {
  return db
    .select()
    .from(paymentTransfers)
    .where(eq(paymentTransfers.customerId, customerId))
    .orderBy(desc(paymentTransfers.createdAt))
    .all();
}
