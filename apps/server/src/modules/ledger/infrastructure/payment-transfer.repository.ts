import { and, desc, eq, lte, sql } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { paymentTransfers } from "../../../shared/database/schema";
import { createBillToken } from "../domain/bill";

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
  /** The bank screenshot the owner uploaded, as a URL; empty until one exists. */
  proofImage?: string | null;
  /** Defaults to a fresh unguessable one: the bill link is `/b/<bill_token>`. */
  billToken?: string;
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
      proofImage: transfer.proofImage ?? null,
      billToken: transfer.billToken ?? createBillToken(),
      createdAt: transfer.createdAt,
    })
    .run();
  return Number(result.lastInsertRowid);
}

export function findTransfer(db: Db, id: number) {
  return db.select().from(paymentTransfers).where(eq(paymentTransfers.id, id)).get() ?? null;
}

/** A bill is found by its token and nothing else: the row number is guessable. */
export function findTransferByBillToken(db: Db, token: string) {
  if (token === "") return null;
  return db
    .select()
    .from(paymentTransfers)
    .where(eq(paymentTransfers.billToken, token))
    .get() ?? null;
}

/** Everything sent to this customer up to and including this transfer. */
export function totalReceivedUpTo(db: Db, customerId: string, id: number): number {
  const row = db
    .select({ total: sql<number>`coalesce(sum(${paymentTransfers.amount}), 0)` })
    .from(paymentTransfers)
    .where(and(eq(paymentTransfers.customerId, customerId), lte(paymentTransfers.id, id)))
    .get();
  return row?.total ?? 0;
}

export function listTransfersForCustomer(db: Db, customerId: string) {
  return db
    .select()
    .from(paymentTransfers)
    .where(eq(paymentTransfers.customerId, customerId))
    .orderBy(desc(paymentTransfers.createdAt))
    .all();
}

/** Every payout we made, newest first. */
export function listTransfers(db: Db, limit = 100) {
  return db
    .select()
    .from(paymentTransfers)
    .orderBy(desc(paymentTransfers.createdAt))
    .limit(limit)
    .all();
}
