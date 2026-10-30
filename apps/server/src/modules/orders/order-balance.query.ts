/**
 * What customers' orders add to their balances (AD-6, D27, R1), read for the payouts module's
 * `getBalances` (code.md §1: other modules read orders only through its queries), grouped by the
 * customer id each order is stored under, for some customers or for all. SQL only SUMs the stored
 * cashback; the waiting estimate is computed in `packages/money` from each awaiting order's stored
 * estimate. FROZEN and REVERSED orders count nowhere; the FROZEN ids are returned so their awards
 * stay suspended (D55).
 */
import type { AffiliateNetwork } from "@cashback/money";
import { and, eq, gt, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { orders } from "./schema";

export interface CustomerTotal {
  readonly customerId: string;
  readonly total: number;
}

export interface AwaitingEstimate {
  readonly customerId: string;
  readonly estimatedCommission: number | null;
  readonly network: AffiliateNetwork | null;
}

export interface OrderBalanceRows {
  /** SUM of the stored cashback of APPROVED orders with no paid time and a commission above 0 (R1), per customer id. */
  readonly approvedUnpaid: readonly CustomerTotal[];
  readonly awaiting: readonly AwaitingEstimate[];
  readonly frozenOrderIds: readonly string[];
}

const payable = and(eq(orders.status, "APPROVED"), isNull(orders.paidAt), gt(orders.approvedCommission, 0));

/** `customerIds` null reads every customer. */
export function orderBalanceRows(db: LedgerDb, customerIds: readonly string[] | null): OrderBalanceRows {
  if (customerIds !== null && customerIds.length === 0) return { approvedUnpaid: [], awaiting: [], frozenOrderIds: [] };
  const mine: SQL = customerIds === null ? isNotNull(orders.customerId) : inArray(orders.customerId, [...customerIds]);
  const approvedUnpaid = db
    .select({ customerId: sql<string>`${orders.customerId}`, total: sql<number>`coalesce(sum(${orders.cashback}), 0)` })
    .from(orders)
    .where(and(mine, payable))
    .groupBy(orders.customerId)
    .all();
  const awaiting = db
    .select({ customerId: sql<string>`${orders.customerId}`, estimatedCommission: orders.estimatedCommission, network: orders.network })
    .from(orders)
    .where(and(mine, eq(orders.status, "AWAITING_APPROVAL")))
    .all();
  const frozen = db.select({ orderId: orders.orderId }).from(orders).where(and(mine, eq(orders.status, "FROZEN"))).all();
  return { approvedUnpaid, awaiting, frozenOrderIds: frozen.map((o) => o.orderId) };
}
