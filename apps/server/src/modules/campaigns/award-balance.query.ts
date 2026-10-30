/**
 * What customers' campaign awards add to their payable balances (AD-6, D27, D55): the SUM of the
 * CONFIRMED awards per customer id, leaving out those whose order is FROZEN (suspended, still
 * CONFIRMED). HELD is never payable; PAID and VOID count nowhere here.
 */
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { campaignAwards } from "./schema";

/** `customerIds` null reads every customer. */
export function confirmedBonusByCustomer(db: LedgerDb, customerIds: readonly string[] | null, suspendedOrderIds: readonly string[]): { customerId: string; total: number }[] {
  if (customerIds !== null && customerIds.length === 0) return [];
  const conditions = [eq(campaignAwards.status, "CONFIRMED")];
  if (customerIds !== null) conditions.push(inArray(campaignAwards.customerId, [...customerIds]));
  if (suspendedOrderIds.length > 0) conditions.push(notInArray(campaignAwards.orderId, [...suspendedOrderIds]));
  return db
    .select({ customerId: campaignAwards.customerId, total: sql<number>`coalesce(sum(${campaignAwards.amount}), 0)` })
    .from(campaignAwards)
    .where(and(...conditions))
    .groupBy(campaignAwards.customerId)
    .all();
}
