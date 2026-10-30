/**
 * A clawback's open amount (AD-6, D42): never a stored column, always the sum of the insert-only
 * ledger entries sharing its clawback id, added in `packages/money`. Negative while money is owed
 * back; the payout that nets it (Epic 4) adds positive entries. A void's credit entries sharing
 * the clawback id (NETTING_REFUND, REFUND_PAID) are not part of it.
 */
import { clawbackOpenAmount } from "@cashback/money";
import { and, eq, inArray } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { CLAWBACK_KINDS, ledgerEntries } from "./schema";

export function clawbackOpen(db: LedgerDb, clawbackId: string): number {
  const rows = db.select({ amount: ledgerEntries.amount }).from(ledgerEntries).where(and(eq(ledgerEntries.clawbackId, clawbackId), inArray(ledgerEntries.kind, [...CLAWBACK_KINDS]))).all();
  return clawbackOpenAmount(rows.map((r) => r.amount));
}
