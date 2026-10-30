/**
 * What customers' orders add to their balances (AD-6, D27, R1), read for the payouts module's
 * `getBalances` (code.md §1: other modules read orders only through its queries), grouped by the
 * customer id each order is stored under, for some customers or for all. SQL only SUMs the stored
 * cashback; the waiting estimate is computed in `packages/money` from each awaiting order's stored
 * estimate. FROZEN and REVERSED orders count nowhere; the FROZEN ids are returned so their awards
 * stay suspended (D55). `payableOrderLines` lists the same payable orders one by one, under the
 * same condition, for the payout list's counts and the payout preview's covered orders (Stories
 * 4.6, 4.7): the lines of a customer always add up to the approved part of its gross.
 */
import type { AffiliateNetwork } from "@cashback/money";
import { and, eq, gt, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { productSnapshotsOf } from "../linking/index";
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

export interface PayableOrderLine {
  readonly orderId: string;
  /** The customer id the order is stored under (a merged id resolves to its survivor). */
  readonly customerId: string;
  /** The stored cashback, whole dong. */
  readonly cashback: number;
  /** The network paid the batch covering the order (D27: information only, never a status). */
  readonly settled: boolean;
  /** The network payout that settled it (D59), or null while the network has not paid it. */
  readonly settledBy: string | null;
  readonly productName: string | null;
  readonly productImageUrl: string | null;
}

/**
 * Every payable order of the customer ids named (null: all), one line each, oldest approval
 * first; with `products`, each line carries its link's product snapshot (D56).
 */
export function payableOrderLines(db: LedgerDb, customerIds: readonly string[] | null, products = false): PayableOrderLine[] {
  if (customerIds !== null && customerIds.length === 0) return [];
  const mine: SQL = customerIds === null ? isNotNull(orders.customerId) : inArray(orders.customerId, [...customerIds]);
  const rows = db
    .select({ orderId: orders.orderId, customerId: sql<string>`${orders.customerId}`, cashback: sql<number>`coalesce(${orders.cashback}, 0)`, settledAt: orders.settledAt, networkBatchId: orders.networkBatchId, requestId: orders.requestId })
    .from(orders)
    .where(and(mine, payable))
    .orderBy(orders.approvedAt, orders.orderId)
    .all();
  const snapshots = products ? productSnapshotsOf(db, rows.flatMap((r) => (r.requestId === null ? [] : [r.requestId]))) : new Map();
  return rows.map((r) => {
    const product = r.requestId === null ? undefined : snapshots.get(r.requestId);
    return { orderId: r.orderId, customerId: r.customerId, cashback: r.cashback, settled: r.settledAt !== null, settledBy: r.settledAt === null ? null : r.networkBatchId, productName: product?.productName ?? null, productImageUrl: product?.productImageUrl ?? null };
  });
}
