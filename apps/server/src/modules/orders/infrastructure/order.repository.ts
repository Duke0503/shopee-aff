import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { orders, stateHistory } from "../../../shared/database/schema";
import {
  APPROVED,
  AWAITING_APPROVAL,
  PAID,
  REJECTED,
  assertMarkPaidAllowed,
  canTransition,
  type OrderStatus,
} from "../domain/order";

/**
 * Persistence for orders and the append-only state history. Every status
 * change goes through a guarded command here, so the safety checks run every
 * time and a line is always written to state_history.
 */
export interface NewOrder {
  orderId: string;
  customerId: string;
  requestId: string | null;
  orderValue: number;
  estimatedCommission: number | null;
  recordedAt: string;
  platform: string;
  nowIso: string;
}

const statusOf = (row: { status: string }): OrderStatus => row.status as OrderStatus;

function appendHistory(
  db: Db,
  orderId: string,
  fromStatus: string | null,
  toStatus: string,
  at: string,
  note: string,
): void {
  db.insert(stateHistory)
    .values({ orderId, fromStatus, toStatus, changedAt: at, note })
    .run();
}

export function recordOrder(db: Db, input: NewOrder): void {
  db.insert(orders)
    .values({
      orderId: input.orderId,
      customerId: input.customerId,
      requestId: input.requestId,
      orderValue: input.orderValue,
      estimatedCommission: input.estimatedCommission,
      status: AWAITING_APPROVAL,
      platform: input.platform,
      recordedAt: input.recordedAt,
      updatedAt: input.nowIso,
    })
    .run();
  appendHistory(db, input.orderId, null, AWAITING_APPROVAL, input.nowIso, "recorded");
}

export function findOrder(db: Db, orderId: string) {
  return db.select().from(orders).where(eq(orders.orderId, orderId)).get() ?? null;
}

export function listOrderHistory(db: Db, orderId: string) {
  return db
    .select()
    .from(stateHistory)
    .where(eq(stateHistory.orderId, orderId))
    .orderBy(asc(stateHistory.id))
    .all();
}

export function markApproved(
  db: Db,
  orderId: string,
  approvedCommission: number,
  cashbackVnd: number,
  nowIso: string,
): void {
  const order = findOrder(db, orderId);
  if (!order) throw new Error(`order ${orderId} not found`);
  if (!canTransition(statusOf(order), APPROVED)) {
    throw new Error(`cannot approve an order that is ${order.status}`);
  }
  db.update(orders)
    .set({ status: APPROVED, approvedCommission, cashbackAmount: cashbackVnd, approvedAt: nowIso, updatedAt: nowIso })
    .where(eq(orders.orderId, orderId))
    .run();
  appendHistory(db, orderId, statusOf(order), APPROVED, nowIso, "approved");
}

export function markRejected(db: Db, orderId: string, reason: string, nowIso: string): void {
  const order = findOrder(db, orderId);
  if (!order) throw new Error(`order ${orderId} not found`);
  if (!canTransition(statusOf(order), REJECTED)) {
    throw new Error(`cannot reject an order that is ${order.status}`);
  }
  db.update(orders)
    .set({ status: REJECTED, rejectionReason: reason, updatedAt: nowIso })
    .where(eq(orders.orderId, orderId))
    .run();
  appendHistory(db, orderId, statusOf(order), REJECTED, nowIso, reason);
}

/** Marks an approved order paid. A second call does nothing (never pay twice). */
export function markPaid(db: Db, orderId: string, nowIso: string): void {
  const order = findOrder(db, orderId);
  if (!order) return;
  assertMarkPaidAllowed({ status: statusOf(order), paidAt: order.paidAt });
  if (order.paidAt !== null) return;
  db.update(orders)
    .set({ status: PAID, paidAt: nowIso, updatedAt: nowIso })
    .where(eq(orders.orderId, orderId))
    .run();
  appendHistory(db, orderId, statusOf(order), PAID, nowIso, "paid");
}

/** Orders, newest purchase first, optionally filtered. */
export function listOrders(
  db: Db,
  filter: { customerId?: string; status?: OrderStatus } = {},
) {
  const conditions = [];
  if (filter.customerId) conditions.push(eq(orders.customerId, filter.customerId));
  if (filter.status) conditions.push(eq(orders.status, filter.status));

  const base = db.select().from(orders);
  const rows = conditions.length > 0 ? base.where(and(...conditions)).all() : base.all();
  return rows.sort((a, b) => (b.recordedAt ?? "").localeCompare(a.recordedAt ?? ""));
}

export interface SettleBatchInput {
  platform: string;
  batchId: string;
  settledAt: string;
  nowIso: string;
  /** When given, only these orders are considered; otherwise the whole platform. */
  orderIds?: string[];
  /** Only settle orders approved/recorded on or before this date. */
  upToDate?: string;
}

/**
 * Marks approved orders as settled by a platform payout batch. Ports
 * `ledger/repository.py::settle_orders_for_batch`. An order already settled is
 * never touched again, so re-syncing the same batch cannot rewrite history.
 */
export function settleOrdersForBatch(db: Db, input: SettleBatchInput): number {
  const values = {
    settlementStatus: "settled",
    payoutBatchId: input.batchId,
    settledAt: input.settledAt,
    updatedAt: input.nowIso,
  };
  const notSettled = sql`${orders.settlementStatus} != 'settled'`;

  if (input.orderIds && input.orderIds.length > 0) {
    return db
      .update(orders)
      .set(values)
      .where(and(inArray(orders.orderId, input.orderIds), notSettled))
      .run().changes;
  }

  const conditions = [eq(orders.platform, input.platform), eq(orders.status, APPROVED), notSettled];
  if (input.upToDate) {
    conditions.push(sql`coalesce(${orders.approvedAt}, ${orders.recordedAt}) <= ${input.upToDate}`);
  }
  return db.update(orders).set(values).where(and(...conditions)).run().changes;
}
