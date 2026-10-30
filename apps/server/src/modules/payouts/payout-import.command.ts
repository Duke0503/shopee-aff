/**
 * The cutover import of payouts (AD-24, Story 2.4): every live transfer becomes one payout,
 * RECORDED, with its live id, amount, reference and bill token unchanged, so an old `/b/<token>`
 * link still opens it. Each covered order is linked by a payout item carrying the order's stored
 * cashback, and each campaign bonus paid with it by an item carrying the award's amount; nothing
 * is computed here (AD-5). Imported payouts have no claim: claims are new-system only (D39). The
 * live system had no clawbacks, so no ledger entry is written. Rows are written in key order, and
 * the import writes one audit entry with its counts in the same transaction (AD-17).
 */
import { assertTablesEmpty } from "../../platform/db/bulk-import";
import type { LedgerDb } from "../../platform/db/ledger";
import type { CommandAudit } from "../../platform/ports/audit.port";
import { payoutItems, payouts, type PayoutItemRow, type PayoutRow } from "./schema";

export type ImportedPayout = Omit<PayoutRow, "origin" | "status" | "claimId" | "voidedAt" | "voidReason" | "payoutId"> & { payoutId: number };
export type ImportedPayoutItem = Omit<PayoutItemRow, "lineNo">;

export interface PayoutsImport {
  payouts: readonly ImportedPayout[];
  /** In line order within each payout. */
  items: readonly ImportedPayoutItem[];
}

export interface PayoutsImportResult {
  payouts: number;
  items: number;
}

export class PayoutsImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayoutsImportError";
  }
}

/** Imports payouts and their items into empty tables; call inside `tx`. */
export function importPayouts(db: LedgerDb, data: PayoutsImport, by: CommandAudit): PayoutsImportResult {
  assertTablesEmpty(db, ["payouts", "payout_items", "ledger_entries"], (table, n) => new PayoutsImportError(`payouts import needs empty tables; ${table} has ${n} rows`));
  for (const p of [...data.payouts].sort((a, b) => a.payoutId - b.payoutId)) {
    db.insert(payouts)
      .values({ ...p, status: "RECORDED", claimId: null, origin: "CUTOVER" })
      .run();
  }
  const lines = new Map<number, number>();
  const items = [...data.items].sort((a, b) => a.payoutId - b.payoutId);
  for (const item of items) {
    const lineNo = (lines.get(item.payoutId) ?? 0) + 1;
    lines.set(item.payoutId, lineNo);
    db.insert(payoutItems)
      .values({ ...item, lineNo })
      .run();
  }
  const result = { payouts: data.payouts.length, items: items.length };
  by.audit.record({ actor: by.actor, event: "payouts.payouts.imported", entityId: by.actor.id, payload: result });
  return result;
}
