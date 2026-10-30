/**
 * The cutover import of campaigns and awards (AD-24, Story 2.4): writes every live campaign with
 * its window already converted to instants by the Vietnam-time rule, and every award with its
 * order, customer, amount and state, exactly as given, into empty tables inside the caller's
 * `tx`. Award ids are kept. Nothing about a slot is recomputed: imported awards are honoured
 * (M14). Rows are written in key order so two imports of one source give identical ledgers, and
 * the import writes one audit entry with its counts in the same transaction (AD-17).
 */
import { assertTablesEmpty, sortByKey } from "../../platform/db/bulk-import";
import type { LedgerDb } from "../../platform/db/ledger";
import type { CommandAudit } from "../../platform/ports/audit.port";
import { campaignAwards, campaigns, type CampaignAwardRow, type CampaignRow } from "./schema";

export type ImportedCampaign = Omit<CampaignRow, "origin">;
export type ImportedAward = Omit<CampaignAwardRow, "origin" | "awardId"> & { awardId: number };

export interface CampaignsImport {
  campaigns: readonly ImportedCampaign[];
  awards: readonly ImportedAward[];
}

export interface CampaignsImportResult {
  campaigns: number;
  awards: number;
}

export class CampaignsImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CampaignsImportError";
  }
}

/** Imports campaigns and awards into empty tables; call inside `tx`. */
export function importCampaigns(db: LedgerDb, data: CampaignsImport, by: CommandAudit): CampaignsImportResult {
  assertTablesEmpty(db, ["campaigns", "campaign_awards"], (table, n) => new CampaignsImportError(`campaigns import needs empty tables; ${table} has ${n} rows`));
  for (const c of sortByKey(data.campaigns, (r) => r.campaignId)) db.insert(campaigns).values({ ...c, origin: "CUTOVER" }).run();
  for (const a of [...data.awards].sort((x, y) => x.awardId - y.awardId)) db.insert(campaignAwards).values({ ...a, origin: "CUTOVER" }).run();
  const result = { campaigns: data.campaigns.length, awards: data.awards.length };
  by.audit.record({ actor: by.actor, event: "campaigns.campaigns.imported", entityId: by.actor.id, payload: result });
  return result;
}
