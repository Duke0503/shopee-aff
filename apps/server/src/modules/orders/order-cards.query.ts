/**
 * What a screen shows of an order it names by id (Story 4.21: a network payout's orders): the
 * customer's code and name, the product snapshot of its link (D56, https images only), its
 * status, its stored approved commission and the network payout that settled it; and the open
 * review cases of one network payout; how many orders each stored customer id holds; and a
 * customer's latest orders for a review case's candidate (Story 4.15). Read only.
 */
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { customerCardsOf } from "../identity/index";
import { productSnapshotsOf } from "../linking/index";
import { orders, reviewCases } from "./schema";

export interface OrderCard {
  readonly orderId: string;
  readonly customerCode: string | null;
  readonly customerName: string | null;
  readonly productName: string | null;
  readonly productImageUrl: string | null;
  readonly status: string;
  readonly approvedCommission: number | null;
  readonly settledBy: string | null;
}

/** The card of each order named that the ledger holds, by order id. */
export function orderCardsOf(db: LedgerDb, orderIds: readonly string[]): Map<string, OrderCard> {
  const ids = [...new Set(orderIds)];
  if (ids.length === 0) return new Map();
  const rows = db
    .select({ orderId: orders.orderId, customerId: orders.customerId, requestId: orders.requestId, status: orders.status, approvedCommission: orders.approvedCommission, settledBy: orders.networkBatchId })
    .from(orders)
    .where(inArray(orders.orderId, ids))
    .all();
  const products = productSnapshotsOf(db, rows.flatMap((r) => (r.requestId === null ? [] : [r.requestId])));
  const customers = customerCardsOf(db, rows.flatMap((r) => (r.customerId === null ? [] : [r.customerId])));
  return new Map(
    rows.map((r) => {
      const product = r.requestId === null ? undefined : products.get(r.requestId);
      const customer = r.customerId === null ? undefined : customers.get(r.customerId);
      const card = { orderId: r.orderId, customerCode: customer?.customerCode ?? null, customerName: customer?.displayName ?? null, productName: product?.productName ?? null, productImageUrl: product?.productImageUrl ?? null, status: r.status, approvedCommission: r.approvedCommission, settledBy: r.settledBy };
      return [r.orderId, card];
    }),
  );
}

/** The OPEN review cases of one network batch (D59): the batch's own (mismatch, changed facts) and those of the orders it refused. */
export function openSettlementCaseIds(db: LedgerDb, network: "shopee" | "accesstrade", networkPayoutId: string, refusedOrderIds: readonly string[]): number[] {
  const own = and(inArray(reviewCases.reason, ["settlement_mismatch", "settlement_facts_changed"]), eq(reviewCases.subject, `payout:${networkPayoutId}`));
  const refused = refusedOrderIds.length === 0 ? undefined : and(inArray(reviewCases.reason, ["settlement_conflict", "settlement_not_approved"]), inArray(reviewCases.subject, [...refusedOrderIds]));
  return db
    .select({ caseId: reviewCases.caseId })
    .from(reviewCases)
    .where(and(eq(reviewCases.status, "OPEN"), eq(reviewCases.network, network), refused === undefined ? own : or(own, refused)))
    .orderBy(reviewCases.caseId)
    .all()
    .map((r) => r.caseId);
}

/** How many orders (any status) each stored customer id holds; the caller credits merged ids to their survivor. */
export function orderCountsByCustomer(db: LedgerDb): { customerId: string; count: number }[] {
  return db
    .select({ customerId: orders.customerId, count: sql<number>`count(*)` })
    .from(orders)
    .where(sql`${orders.customerId} IS NOT NULL`)
    .groupBy(orders.customerId)
    .all()
    .flatMap((r) => (r.customerId === null ? [] : [{ customerId: r.customerId, count: r.count }]));
}

/** How many orders the stored ids hold together (a survivor's id and its aliases). */
export function orderCountOf(db: LedgerDb, customerIds: readonly string[]): number {
  if (customerIds.length === 0) return 0;
  return (
    db
      .select({ count: sql<number>`count(*)` })
      .from(orders)
      .where(inArray(orders.customerId, [...customerIds]))
      .get()?.count ?? 0
  );
}

export interface RecentOrder {
  readonly orderId: string;
  readonly productName: string | null;
  readonly productImageUrl: string | null;
  readonly status: string;
  readonly cashback: number | null;
  readonly recordedAt: string | null;
}

/** The latest orders under the stored ids, newest first, with their product snapshot (D56). */
export function recentOrdersOf(
  db: LedgerDb,
  customerIds: readonly string[],
  limit: number,
): RecentOrder[] {
  if (customerIds.length === 0) return [];
  const rows = db
    .select({
      orderId: orders.orderId,
      requestId: orders.requestId,
      status: orders.status,
      cashback: orders.cashback,
      recordedAt: orders.recordedAt,
    })
    .from(orders)
    .where(inArray(orders.customerId, [...customerIds]))
    .orderBy(sql`${orders.recordedAt} DESC NULLS LAST`, desc(orders.orderId))
    .limit(limit)
    .all();
  const products = productSnapshotsOf(
    db,
    rows.flatMap((r) => (r.requestId === null ? [] : [r.requestId])),
  );
  return rows.map(({ requestId, ...r }) => {
    const product = requestId === null ? undefined : products.get(requestId);
    return {
      ...r,
      productName: product?.productName ?? null,
      productImageUrl: product?.productImageUrl ?? null,
    };
  });
}
