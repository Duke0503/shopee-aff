/**
 * The campaigns for the admin desk's campaign screen (FR-23, Story 4.20): every campaign with its
 * awards counted by status in one grouped read, and the latest awards of each, newest first. A
 * HELD, CONFIRMED or PAID award holds a slot; a VOID one gave it back. Who the customer is and
 * what the event earned are composed by the caller (identity and the Overview's events block).
 */
import { desc, inArray, sql } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { campaignAwards, campaigns, CAMPAIGN_AWARD_STATUSES } from "./schema";

type AwardStatus = (typeof CAMPAIGN_AWARD_STATUSES)[number];

export interface CampaignListRow {
  readonly campaignId: string;
  readonly name: string;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly slots: number;
  readonly bonus: number;
  readonly minOrderValue: number;
  readonly platforms: readonly string[];
  readonly perCustomer: number;
  readonly acceptsAwards: boolean;
  readonly awards: Readonly<Record<AwardStatus, number>>;
}

export interface CampaignAwardFact {
  readonly awardId: number;
  readonly campaignId: string;
  readonly customerId: string;
  readonly orderId: string;
  readonly createdAt: string | null;
  readonly status: AwardStatus;
}

const NO_AWARDS: Record<AwardStatus, number> = { HELD: 0, CONFIRMED: 0, PAID: 0, VOID: 0 };

/** Every campaign, the latest start first; a campaign without a window last. */
export function campaignList(db: LedgerDb): CampaignListRow[] {
  const counts = db
    .select({ campaignId: campaignAwards.campaignId, status: campaignAwards.status, n: sql<number>`count(*)` })
    .from(campaignAwards)
    .groupBy(campaignAwards.campaignId, campaignAwards.status)
    .all();
  return db
    .select()
    .from(campaigns)
    .orderBy(sql`${campaigns.startsAt} is null`, desc(campaigns.startsAt), campaigns.campaignId)
    .all()
    .map((c) => {
      const awards = { ...NO_AWARDS };
      for (const row of counts) if (row.campaignId === c.campaignId) awards[row.status] = row.n;
      return {
        campaignId: c.campaignId,
        name: c.name,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        slots: c.slots,
        bonus: c.bonus,
        minOrderValue: c.minOrderValue,
        platforms: c.platforms === "" ? [] : c.platforms.split(","),
        perCustomer: c.perCustomer,
        acceptsAwards: c.acceptsAwards,
        awards,
      };
    });
}

/** The latest `limit` awards of each campaign named, newest first. */
export function latestAwards(db: LedgerDb, campaignIds: readonly string[], limit: number): Map<string, CampaignAwardFact[]> {
  const out = new Map<string, CampaignAwardFact[]>(campaignIds.map((id) => [id, []]));
  if (campaignIds.length === 0) return out;
  const rows = db
    .select({ awardId: campaignAwards.awardId, campaignId: campaignAwards.campaignId, customerId: campaignAwards.customerId, orderId: campaignAwards.orderId, createdAt: campaignAwards.createdAt, status: campaignAwards.status })
    .from(campaignAwards)
    .where(inArray(campaignAwards.campaignId, [...campaignIds]))
    .orderBy(desc(campaignAwards.awardId))
    .all();
  for (const row of rows) {
    const list = out.get(row.campaignId);
    if (list !== undefined && list.length < limit) list.push(row);
  }
  return out;
}
