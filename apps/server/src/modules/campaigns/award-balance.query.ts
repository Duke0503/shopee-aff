/**
 * What customers' campaign awards add to their payable balances (AD-6, D27, D55): the SUM of the
 * CONFIRMED awards per customer id, leaving out those whose order is FROZEN (suspended, still
 * CONFIRMED). HELD is never payable; PAID and VOID count nowhere here. `confirmedBonusLines` lists the
 * same awards one by one, under the same condition, for the payout preview (Story 4.7).
 */
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { campaignAwards, campaigns } from "./schema";

/** `customerIds` null reads every customer. */
function payableAwards(customerIds: readonly string[] | null, suspendedOrderIds: readonly string[]) {
  const conditions = [eq(campaignAwards.status, "CONFIRMED")];
  if (customerIds !== null) conditions.push(inArray(campaignAwards.customerId, [...customerIds]));
  if (suspendedOrderIds.length > 0) conditions.push(notInArray(campaignAwards.orderId, [...suspendedOrderIds]));
  return and(...conditions);
}

export function confirmedBonusByCustomer(db: LedgerDb, customerIds: readonly string[] | null, suspendedOrderIds: readonly string[]): { customerId: string; total: number }[] {
  if (customerIds !== null && customerIds.length === 0) return [];
  return db
    .select({ customerId: campaignAwards.customerId, total: sql<number>`coalesce(sum(${campaignAwards.amount}), 0)` })
    .from(campaignAwards)
    .where(payableAwards(customerIds, suspendedOrderIds))
    .groupBy(campaignAwards.customerId)
    .all();
}

export interface BonusLine {
  readonly awardId: number;
  readonly customerId: string;
  readonly orderId: string;
  readonly campaignName: string;
  readonly amount: number;
}

/** Every payable award of the customer ids named, one line each, by award id. */
export function confirmedBonusLines(db: LedgerDb, customerIds: readonly string[], suspendedOrderIds: readonly string[]): BonusLine[] {
  if (customerIds.length === 0) return [];
  return db
    .select({ awardId: campaignAwards.awardId, customerId: campaignAwards.customerId, orderId: campaignAwards.orderId, campaignName: campaigns.name, amount: campaignAwards.amount })
    .from(campaignAwards)
    .innerJoin(campaigns, eq(campaigns.campaignId, campaignAwards.campaignId))
    .where(payableAwards(customerIds, suspendedOrderIds))
    .orderBy(campaignAwards.awardId)
    .all();
}
