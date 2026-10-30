import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { campaignAwards, campaigns, customers, orders } from "../../../shared/database/schema";
import { isCampaignRunning, windowOpen } from "../domain/campaign";

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

export function splitList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/** Live slots per customer in one campaign. */
export function liveCounts(db: Db, campaignId: string): Map<string, number> {
  const rows = db
    .select({ customerId: campaignAwards.customerId, n: sql<number>`count(*)` })
    .from(campaignAwards)
    .where(and(eq(campaignAwards.campaignId, campaignId), ne(campaignAwards.status, AWARD_VOID)))
    .groupBy(campaignAwards.customerId)
    .all();
  return new Map(rows.map((row) => [row.customerId, row.n]));
}

/** Live (non-void) slots used in one campaign. */
export function liveTotal(db: Db, campaignId: string): number {
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

/** A neutral shape for one award, so Ledger need not know Orders' types. */
export interface OrderAward {
  awardId: number;
  status: string;
  bonusVnd: number;
}

/** Every award on the given orders, whatever its status. */
export function awardsForOrders(db: Db, orderIds: string[]): OrderAward[] {
  if (orderIds.length === 0) return [];
  return db
    .select({
      awardId: campaignAwards.id,
      status: campaignAwards.status,
      bonusVnd: campaignAwards.amount,
    })
    .from(campaignAwards)
    .where(inArray(campaignAwards.orderId, orderIds))
    .all();
}

/** A bonus as a receipt shows it: what it was, and which event paid it. */
export interface OrderBonus {
  orderId: string;
  bonusVnd: number;
  campaignName: string;
}

/**
 * The bonuses attached to these orders, for showing (never for paying: the
 * payable ones are CONFIRMED and go through `confirmedBonusesByCustomer`).
 * A void award is not a bonus, so it is left out.
 */
export function bonusesForOrders(db: Db, orderIds: string[]): OrderBonus[] {
  if (orderIds.length === 0) return [];
  return db
    .select({
      orderId: campaignAwards.orderId,
      bonusVnd: campaignAwards.amount,
      campaignName: campaigns.name,
    })
    .from(campaignAwards)
    .leftJoin(campaigns, eq(campaigns.campaignId, campaignAwards.campaignId))
    .where(and(inArray(campaignAwards.orderId, orderIds), ne(campaignAwards.status, AWARD_VOID)))
    .all()
    .map((row) => ({ ...row, campaignName: row.campaignName ?? "" }));
}

/** CONFIRMED bonuses per customer: exactly what is payable, right now. */
export function confirmedBonusesByCustomer(db: Db): Map<string, number> {
  const rows = db
    .select({
      customerId: campaignAwards.customerId,
      total: sql<number>`COALESCE(SUM(${campaignAwards.amount}), 0)`,
    })
    .from(campaignAwards)
    .where(eq(campaignAwards.status, AWARD_CONFIRMED))
    .groupBy(campaignAwards.customerId)
    .all();
  return new Map(rows.map((row) => [row.customerId, Number(row.total)]));
}

/** One customer's bonuses split by where they are in their life. */
export function bonusTotalsForCustomer(
  db: Db,
  customerId: string,
): { confirmed: number; awaiting: number; paid: number } {
  const rows = db
    .select({
      status: campaignAwards.status,
      total: sql<number>`COALESCE(SUM(${campaignAwards.amount}), 0)`,
    })
    .from(campaignAwards)
    .where(eq(campaignAwards.customerId, customerId))
    .groupBy(campaignAwards.status)
    .all();
  const byStatus = new Map(rows.map((row) => [row.status, Number(row.total)]));
  return {
    confirmed: byStatus.get(AWARD_CONFIRMED) ?? 0,
    awaiting: byStatus.get(AWARD_HELD) ?? 0,
    paid: byStatus.get(AWARD_PAID) ?? 0,
  };
}

/** Marks the confirmed bonuses on paid orders paid, so they are never sent twice. */
export function settleCampaignBonusesForOrders(
  db: Db,
  orderIds: string[],
  nowIso: string,
): number {
  if (orderIds.length === 0) return 0;
  return db
    .update(campaignAwards)
    .set({ status: AWARD_PAID, paidAt: nowIso })
    .where(and(inArray(campaignAwards.orderId, orderIds), eq(campaignAwards.status, AWARD_CONFIRMED)))
    .run().changes;
}

export interface NewCampaign {
  campaignId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  slots: number;
  bonusVnd: number;
  minOrderValue: number;
  platforms: string;
  perCustomer: number;
  createdAt: string;
}

export function campaignExists(db: Db, campaignId: string): boolean {
  return (
    db
      .select({ campaignId: campaigns.campaignId })
      .from(campaigns)
      .where(eq(campaigns.campaignId, campaignId))
      .get() !== undefined
  );
}

/** A new event is a row of data, not code: one honest INSERT. */
export function insertCampaign(db: Db, campaign: NewCampaign): void {
  db.insert(campaigns)
    .values({ ...campaign, status: "active" })
    .run();
}
