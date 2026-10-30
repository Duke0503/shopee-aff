/**
 * A clawback's open amount (AD-6, D42): never a stored column, always the sum of the insert-only
 * ledger entries sharing its clawback id, added in `packages/money`. Negative while money is owed
 * back; the payout that nets it (Epic 4) adds positive entries.
 */
import { clawbackOpenAmount } from "@cashback/money";
import { eq } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { ledgerEntries } from "./schema";

export function clawbackOpen(db: LedgerDb, clawbackId: string): number {
  const rows = db.select({ amount: ledgerEntries.amount }).from(ledgerEntries).where(eq(ledgerEntries.clawbackId, clawbackId)).all();
  return clawbackOpenAmount(rows.map((r) => r.amount));
}
