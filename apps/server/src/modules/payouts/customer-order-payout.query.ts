/**
 * What the payouts module knows of one of the customer's orders (Story 7.4, pen.dev opJFP): the
 * recorded payout that paid it, with its public receipt (D49), and whether the network cancelled
 * it after it was paid (a `cancel_after_payout` clawback, D4). The payout is read only under the
 * session customer's stored ids. Read only.
 */
import { and, desc, eq, inArray } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { ledgerEntries, payoutItems, payouts } from "./schema";

export interface OrderPayout {
  readonly recordedAt: string | null;
  readonly receiptToken: string | null;
}

/** The latest recorded payout of the customer that carried the order; null when none did. */
export function orderPayoutOf(db: LedgerDb, customerIds: readonly string[], orderId: string): OrderPayout | null {
  if (customerIds.length === 0) return null;
  const row = db
    .select({ recordedAt: payouts.recordedAt, receiptToken: payouts.receiptToken })
    .from(payoutItems)
    .innerJoin(payouts, eq(payouts.payoutId, payoutItems.payoutId))
    .where(and(eq(payoutItems.orderId, orderId), eq(payoutItems.kind, "ORDER"), eq(payouts.status, "RECORDED"), inArray(payouts.customerId, [...customerIds])))
    .orderBy(desc(payouts.recordedAt))
    .limit(1)
    .get();
  return row ?? null;
}

/** Whether the network cancelled this order after it was paid. */
export function cancelledAfterPayout(db: LedgerDb, orderId: string): boolean {
  const row = db
    .select({ entryId: ledgerEntries.entryId })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.orderId, orderId), eq(ledgerEntries.kind, "CLAWBACK"), eq(ledgerEntries.reason, "cancel_after_payout")))
    .limit(1)
    .get();
  return row !== undefined;
}
