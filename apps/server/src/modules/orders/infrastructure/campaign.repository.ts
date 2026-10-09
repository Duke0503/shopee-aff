import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { campaignAwards, campaigns, customers, orders } from "../../../shared/database/schema";

/** Campaigns are rows of data, not code. Newest event first. */
export function listCampaigns(db: Db) {
  return db.select().from(campaigns).orderBy(desc(campaigns.startsAt)).all();
}

export const AWARD_HELD = "held";
export const AWARD_CONFIRMED = "confirmed";
export const AWARD_PAID = "paid";
export const AWARD_VOID = "void";

export type CampaignRow = typeof campaigns.$inferSelect;

export interface EvaluateChanges {
  voided: number;
  confirmed: number;
  paid: number;
  held: number;
}

export function activeCampaigns(db: Db): CampaignRow[] {
  return db
    .select()
    .from(campaigns)
    .where(eq(campaigns.status, "active"))
    .orderBy(asc(campaigns.startsAt))
    .all();
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/** `startsAt <= moment < endsAt`, compared as times so formats do not matter. */
export function windowOpen(startsAt: string, endsAt: string, moment: string | null): boolean {
  if (!moment) return false;
  const at = Date.parse(moment);
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (Number.isNaN(at) || Number.isNaN(start) || Number.isNaN(end)) return false;
  return at >= start && at < end;
}

export function isCampaignRunning(campaign: CampaignRow, nowIso: string): boolean {
  return windowOpen(campaign.startsAt, campaign.endsAt, nowIso);
}

function liveCounts(db: Db, campaignId: string): Map<string, number> {
  const rows = db
    .select({ customerId: campaignAwards.customerId, n: sql<number>`count(*)` })
    .from(campaignAwards)
    .where(and(eq(campaignAwards.campaignId, campaignId), ne(campaignAwards.status, AWARD_VOID)))
    .groupBy(campaignAwards.customerId)
    .all();
  return new Map(rows.map((row) => [row.customerId, row.n]));
}

function liveTotal(db: Db, campaignId: string): number {
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(campaignAwards)
      .where(and(eq(campaignAwards.campaignId, campaignId), ne(campaignAwards.status, AWARD_VOID)))
      .get()?.n ?? 0
  );
}

function atCap(campaign: CampaignRow, held: number): boolean {
  return campaign.perCustomer > 0 && held >= campaign.perCustomer;
}

interface Candidate {
  orderId: string;
  customerId: string;
}

/** Eligible orders not already holding a live slot, earliest first, under the cap. */
function candidatesFor(db: Db, campaign: CampaignRow): Candidate[] {
  const platforms = splitList(campaign.platforms);
  const excluded = new Set(splitList(campaign.excludedCustomers));
  const claimed = new Set(
    db
      .select({ orderId: campaignAwards.orderId })
      .from(campaignAwards)
      .where(
        and(eq(campaignAwards.campaignId, campaign.campaignId), ne(campaignAwards.status, AWARD_VOID)),
      )
      .all()
      .map((row) => row.orderId),
  );

  const rows = db
    .select({
      orderId: orders.orderId,
      customerId: orders.customerId,
      recordedAt: orders.recordedAt,
      orderValue: orders.orderValue,
      platform: orders.platform,
      role: customers.role,
    })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.customerId))
    .where(and(ne(orders.status, "rejected"), eq(customers.role, "user")))
    .all();

  const eligible = rows
    .filter((row): row is (typeof rows)[number] & { customerId: string } => row.customerId !== null)
    .filter((row) => !claimed.has(row.orderId))
    .filter((row) => windowOpen(campaign.startsAt, campaign.endsAt, row.recordedAt))
    .filter((row) => platforms.length === 0 || platforms.includes(row.platform ?? "shopee"))
    .filter((row) => !excluded.has(row.customerId))
    .filter((row) => (row.orderValue ?? 0) >= campaign.minOrderValue)
    .sort(
      (a, b) =>
        (a.recordedAt ?? "").localeCompare(b.recordedAt ?? "") ||
        a.orderId.localeCompare(b.orderId),
    );

  const held = liveCounts(db, campaign.campaignId);
  const chosen: Candidate[] = [];
  for (const row of eligible) {
    const used = held.get(row.customerId) ?? 0;
    if (atCap(campaign, used)) continue;
    held.set(row.customerId, used + 1);
    chosen.push({ orderId: row.orderId, customerId: row.customerId });
  }
  return chosen;
}

/** Follow every live slot's order: void on cancel, confirm on approve, pay on paid. */
function followLiveAwards(db: Db, campaign: CampaignRow, nowIso: string): Omit<EvaluateChanges, "held"> {
  const changes = { voided: 0, confirmed: 0, paid: 0 };
  const rows = db
    .select({
      id: campaignAwards.id,
      status: campaignAwards.status,
      orderStatus: orders.status,
      paidAt: orders.paidAt,
    })
    .from(campaignAwards)
    .innerJoin(orders, eq(campaignAwards.orderId, orders.orderId))
    .where(
      and(
        eq(campaignAwards.campaignId, campaign.campaignId),
        inArray(campaignAwards.status, [AWARD_HELD, AWARD_CONFIRMED]),
      ),
    )
    .all();

  for (const row of rows) {
    if (row.orderStatus === "rejected") {
      db.update(campaignAwards)
        .set({ status: AWARD_VOID, voidedAt: nowIso })
        .where(eq(campaignAwards.id, row.id))
        .run();
      changes.voided += 1;
    } else if (row.paidAt) {
      db.update(campaignAwards)
        .set({
          status: AWARD_PAID,
          paidAt: row.paidAt,
          confirmedAt: sql`coalesce(${campaignAwards.confirmedAt}, ${nowIso})`,
        })
        .where(eq(campaignAwards.id, row.id))
        .run();
      changes.paid += 1;
    } else if (row.status === AWARD_HELD && row.orderStatus === "approved") {
      db.update(campaignAwards)
        .set({ status: AWARD_CONFIRMED, confirmedAt: nowIso })
        .where(eq(campaignAwards.id, row.id))
        .run();
      changes.confirmed += 1;
    }
  }
  return changes;
}

/** Fill free slots with the next eligible orders, only while the event runs. */
function fillFreeSlots(db: Db, campaign: CampaignRow, nowIso: string): number {
  const free = campaign.slots - liveTotal(db, campaign.campaignId);
  if (free <= 0) return 0;
  const chosen = candidatesFor(db, campaign).slice(0, free);
  for (const order of chosen) {
    db.insert(campaignAwards)
      .values({
        campaignId: campaign.campaignId,
        customerId: order.customerId,
        orderId: order.orderId,
        amount: campaign.bonusVnd,
        status: AWARD_HELD,
        createdAt: nowIso,
      })
      .run();
  }
  return chosen.length;
}

/**
 * Bring every active campaign's slots up to date. Safe to run often: a slot is
 * lost only when its own order is cancelled, and a freed slot goes to the next
 * order in line only while the event still runs.
 */
export function evaluateCampaigns(db: Db, nowIso: string): EvaluateChanges {
  const changes: EvaluateChanges = { voided: 0, confirmed: 0, paid: 0, held: 0 };
  for (const campaign of activeCampaigns(db)) {
    const followed = followLiveAwards(db, campaign, nowIso);
    changes.voided += followed.voided;
    changes.confirmed += followed.confirmed;
    changes.paid += followed.paid;
    if (isCampaignRunning(campaign, nowIso)) {
      changes.held += fillFreeSlots(db, campaign, nowIso);
    }
  }
  return changes;
}

export interface Standing {
  campaignId: string;
  name: string;
  rank: number;
  slots: number;
  amount: number;
  status: string;
}

/** The live slot one order holds, with its rank among the campaign's live slots. */
export function standingForOrder(db: Db, orderId: string): Standing | null {
  const award = db
    .select({
      id: campaignAwards.id,
      campaignId: campaignAwards.campaignId,
      name: campaigns.name,
      slots: campaigns.slots,
      amount: campaignAwards.amount,
      status: campaignAwards.status,
    })
    .from(campaignAwards)
    .innerJoin(campaigns, eq(campaignAwards.campaignId, campaigns.campaignId))
    .where(and(eq(campaignAwards.orderId, orderId), ne(campaignAwards.status, AWARD_VOID)))
    .orderBy(asc(campaignAwards.id))
    .get();
  if (!award) return null;

  const live = db
    .select({ id: campaignAwards.id, recordedAt: orders.recordedAt })
    .from(campaignAwards)
    .innerJoin(orders, eq(campaignAwards.orderId, orders.orderId))
    .where(and(eq(campaignAwards.campaignId, award.campaignId), ne(campaignAwards.status, AWARD_VOID)))
    .all()
    .sort(
      (a, b) =>
        (a.recordedAt ?? "").localeCompare(b.recordedAt ?? "") || a.id - b.id,
    );

  return {
    campaignId: award.campaignId,
    name: award.name,
    rank: live.findIndex((row) => row.id === award.id) + 1,
    slots: award.slots,
    amount: award.amount,
    status: award.status,
  };
}
