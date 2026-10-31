/**
 * The campaigns module's part of the Overview (FR-25, docs/operations/dashboard-spec.md Blocks 2
 * and 6): the awards that hold a slot (HELD, CONFIRMED, PAID; a VOID award holds none) with their
 * order and bonus, and the campaigns whose window overlaps a period (start inclusive, end
 * exclusive, D22). The composition decides which bonuses count where: a bonus counts as spent
 * when its award is CONFIRMED or PAID.
 */
import type { InstantRange } from "@cashback/core";
import { and, gt, inArray, isNotNull, lt, ne } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { campaignAwards, campaigns } from "./schema";

export interface AwardFact {
  readonly campaignId: string;
  readonly orderId: string;
  readonly amount: number;
  readonly status: "HELD" | "CONFIRMED" | "PAID";
}

/** Awards that hold a slot: of the campaigns named, or (null) of every campaign. */
export function liveAwards(db: LedgerDb, campaignIds: readonly string[] | null): AwardFact[] {
  if (campaignIds !== null && campaignIds.length === 0) return [];
  const where = campaignIds === null ? ne(campaignAwards.status, "VOID") : and(ne(campaignAwards.status, "VOID"), inArray(campaignAwards.campaignId, [...campaignIds]));
  return db
    .select({ campaignId: campaignAwards.campaignId, orderId: campaignAwards.orderId, amount: campaignAwards.amount, status: campaignAwards.status })
    .from(campaignAwards)
    .where(where)
    .orderBy(campaignAwards.awardId)
    .all()
    .map((a) => ({ ...a, status: a.status as AwardFact["status"] }));
}

export interface CampaignWindow {
  readonly campaignId: string;
  readonly name: string;
  readonly startsAt: string;
  /** Exclusive. */
  readonly endsAt: string;
  readonly slots: number;
}

/** Campaigns whose window overlaps the range; a campaign without a window is in none. */
export function campaignsOverlapping(db: LedgerDb, range: InstantRange): CampaignWindow[] {
  return db
    .select({ campaignId: campaigns.campaignId, name: campaigns.name, startsAt: campaigns.startsAt, endsAt: campaigns.endsAt, slots: campaigns.slots })
    .from(campaigns)
    .where(and(isNotNull(campaigns.startsAt), isNotNull(campaigns.endsAt), lt(campaigns.startsAt, range.to), gt(campaigns.endsAt, range.from)))
    .orderBy(campaigns.startsAt, campaigns.campaignId)
    .all()
    .map((c) => ({ ...c, startsAt: c.startsAt ?? "", endsAt: c.endsAt ?? "" }));
}

/** Campaign names by id. */
export function campaignNamesOf(db: LedgerDb, campaignIds: readonly string[]): Map<string, string> {
  if (campaignIds.length === 0) return new Map();
  return new Map(db.select({ id: campaigns.campaignId, name: campaigns.name }).from(campaigns).where(inArray(campaigns.campaignId, [...campaignIds])).all().map((c) => [c.id, c.name]));
}
