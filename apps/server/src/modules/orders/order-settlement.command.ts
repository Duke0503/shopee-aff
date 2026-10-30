/**
 * Orders and network payout batches (D27, D59, FR-19; Story 4.21). The payouts module matches a
 * batch to exact orders; this module owns the orders table, so it answers which orders a batch
 * may cover, writes the settled mark and keeps the latest batch's withholding per network.
 * Settled is a fact beside the status, never a status: settling sets `network_batch_id` (the
 * network's payout id) and `settled_at` and nothing else, which the paid-order triggers allow, so
 * a PAID order is settled without being changed. The caller's one audit entry records it.
 *
 * An order's gross is its approved commission. The live system stored none (production backup:
 * approved_commission and approved_at NULL on every order), so an imported order shows its live
 * estimate, for display only. A batch's candidates are the network's APPROVED or PAID orders
 * approved by this system (origin REPORT, with the approval time and approved commission it
 * recorded), not settled yet, approved in the batch's window: at or after its start, before the
 * batch's creation. An imported order is never a candidate: the live ledger has no approval time,
 * and its paid or update time is when the operator paid the customer, after the network paid. The
 * filter is one SQL statement.
 */
import type { Instant, OrderStatus } from "@cashback/core";
import type { AffiliateNetwork } from "@cashback/money";
import { and, eq, gte, inArray, isNotNull, isNull, lt, sql, type SQL } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { networkWithholding, orders } from "./schema";

export interface SettlementOrder {
  readonly orderId: string;
  readonly network: AffiliateNetwork | null;
  readonly customerId: string | null;
  readonly status: OrderStatus;
  /** Approved commission; for display, the live estimate of an imported order; null before approval. */
  readonly gross: number | null;
  readonly approvalAt: string | null;
  /** The network payout that settled it, or null. */
  readonly networkBatchId: string | null;
}

const GROSS = sql<number | null>`coalesce(${orders.approvedCommission}, case when ${orders.origin} = 'CUTOVER' then ${orders.estimatedCommission} end)`;

function selectLines(db: LedgerDb, where: SQL | undefined): SettlementOrder[] {
  return db
    .select({ orderId: orders.orderId, network: orders.network, customerId: orders.customerId, status: orders.status, gross: GROSS, approvalAt: orders.approvedAt, networkBatchId: orders.networkBatchId })
    .from(orders)
    .where(where)
    .orderBy(orders.orderId)
    .all();
}

export interface SettlementWindow {
  /** Inclusive; null for a network's first batch. */
  readonly from: string | null;
  /** Exclusive: the batch's creation time. */
  readonly to: string;
}

/** The unsettled approved or paid orders of `network` this system approved in the window, by order id. */
export function settlementCandidates(db: LedgerDb, network: AffiliateNetwork, window: SettlementWindow): SettlementOrder[] {
  const where = and(
    eq(orders.network, network),
    eq(orders.origin, "REPORT"),
    inArray(orders.status, ["APPROVED", "PAID"]),
    isNull(orders.networkBatchId),
    isNotNull(orders.approvedCommission),
    lt(orders.approvedAt, window.to),
    window.from === null ? undefined : gte(orders.approvedAt, window.from),
  );
  return selectLines(db, where);
}

/** The orders named, by id; an id the ledger does not hold is absent. */
export function settlementOrdersOf(db: LedgerDb, orderIds: readonly string[]): Map<string, SettlementOrder> {
  const ids = [...new Set(orderIds)];
  if (ids.length === 0) return new Map();
  return new Map(selectLines(db, inArray(orders.orderId, ids)).map((o) => [o.orderId, o]));
}

export interface SettleInput {
  readonly orderIds: readonly string[];
  readonly networkPayoutId: string;
  readonly settledAt: Instant;
}

/** Marks the orders settled by the batch; call inside `tx`. An order already settled is left as it is. Returns how many were marked. */
export function settleOrders(db: LedgerDb, input: SettleInput): number {
  if (input.orderIds.length === 0) return 0;
  return db
    .update(orders)
    .set({ networkBatchId: input.networkPayoutId, settledAt: input.settledAt })
    .where(and(inArray(orders.orderId, [...input.orderIds]), isNull(orders.networkBatchId)))
    .returning({ orderId: orders.orderId })
    .all().length;
}

export interface WithholdingObservation {
  readonly network: AffiliateNetwork;
  readonly withheld: boolean;
  readonly networkPayoutId: string;
  /** The batch's creation time at the network. */
  readonly observedAt: string;
}

/** Keeps the batch's withholding when it is the network's latest batch; call inside `tx`. True when it became the estimate. */
export function observeWithholding(db: LedgerDb, o: WithholdingObservation, at: Instant): boolean {
  const current = db.select().from(networkWithholding).where(eq(networkWithholding.network, o.network)).get();
  if (current !== undefined && (current.observedAt > o.observedAt || (current.observedAt === o.observedAt && current.withheld === o.withheld))) return false;
  db.insert(networkWithholding)
    .values({ ...o, recordedAt: at })
    .onConflictDoUpdate({ target: networkWithholding.network, set: { withheld: o.withheld, networkPayoutId: o.networkPayoutId, observedAt: o.observedAt, recordedAt: at } })
    .run();
  return true;
}

/** The latest batch's withholding of the network, or null when none is known. */
export function latestWithholding(db: LedgerDb, network: AffiliateNetwork): { withheld: boolean; networkPayoutId: string; observedAt: string } | null {
  return db.select({ withheld: networkWithholding.withheld, networkPayoutId: networkWithholding.networkPayoutId, observedAt: networkWithholding.observedAt }).from(networkWithholding).where(eq(networkWithholding.network, network)).get() ?? null;
}
