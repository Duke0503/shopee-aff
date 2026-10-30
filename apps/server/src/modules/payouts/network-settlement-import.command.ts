/**
 * The live network payout batches at cutover (FR-33, D53, D59; Story 4.21). Each live
 * `payout_batches` row becomes one HISTORIC network settlement with its id, status, received and
 * gross amounts and times unchanged, and the withholding, fee and tax read from its amounts; the
 * latest one becomes the estimate for later approvals. A historic batch is never matched to
 * orders and opens no case: the live ledger kept no approval time (every approved_at NULL), and an
 * imported order's paid or update time is when the operator paid the customer, after the network
 * paid, so no window can place it. Imported orders keep no settlement link; their PAID state is
 * the live system's. Batches the new system records after go-live are matched as usual.
 */
import type { Instant } from "@cashback/core";
import type { AffiliateNetwork } from "@cashback/money";

import type { LedgerDb } from "../../platform/db/ledger";
import type { CommandAudit } from "../../platform/ports/audit.port";
import { observeWithholding } from "../orders/index";
import { withholdingOf } from "./network-settlement.command";
import { networkSettlements } from "./schema";

export interface ImportedNetworkSettlement {
  readonly network: AffiliateNetwork;
  readonly networkPayoutId: string;
  readonly status: "PROCESSING" | "PAID" | "FAILED";
  readonly amount: number;
  readonly eligibleAmount: number | null;
  readonly createdAt: Instant | null;
  readonly paidAt: Instant | null;
}

export interface NetworkSettlementsImportResult {
  readonly settlements: number;
}

const byCreation = (a: ImportedNetworkSettlement, b: ImportedNetworkSettlement): number => (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.networkPayoutId.localeCompare(b.networkPayoutId);

/** Writes the live batches as HISTORIC; call inside the import's `tx`. */
export function importNetworkSettlements(db: LedgerDb, rows: readonly ImportedNetworkSettlement[], importedAt: Instant, by: CommandAudit): NetworkSettlementsImportResult {
  for (const row of [...rows].sort(byCreation)) {
    const values = { ...row, ...withholdingOf(row.network, row.eligibleAmount, row.amount), match: "HISTORIC" as const, origin: "CUTOVER" as const, recordedAt: importedAt, updatedAt: importedAt };
    const stored = db.insert(networkSettlements).values(values).returning().get();
    if (stored.withheld !== null && stored.createdAt !== null) observeWithholding(db, { network: stored.network, withheld: stored.withheld, networkPayoutId: stored.networkPayoutId, observedAt: stored.createdAt }, importedAt);
  }
  by.audit.record({ actor: by.actor, event: "payouts.network_settlements.imported", entityId: "cutover", payload: { settlements: rows.length } });
  return { settlements: rows.length };
}
