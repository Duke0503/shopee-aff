/**
 * The reads and the plain writes reconciliation does on the orders tables (AD-4, AD-8), inside
 * the caller's transaction. Status changes are not here: they come only from `transition` and are
 * carried out by report-apply.command.ts and order-payout.command.ts.
 */
import type { Instant } from "@cashback/core";
import type { AffiliateNetwork } from "@cashback/money";
import { and, desc, eq } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { resolveCustomer } from "../identity/index";
import type { ObservedStatus } from "./domain/report-signal";
import type { TransitionOrder } from "./domain/transition";
import { orderItems, orderObservations, orders, reviewCases } from "./schema";

export type StoredOrder = typeof orders.$inferSelect;

export function findOrder(db: LedgerDb, orderId: string): StoredOrder | null {
  return db.select().from(orders).where(eq(orders.orderId, orderId)).get() ?? null;
}

const isGuest = (db: LedgerDb, customerId: string | null): boolean => customerId !== null && resolveCustomer(db, customerId)?.role === "HOUSE";

/** The stored order as `transition` reads it; the guest flag comes from the owner's role (D5). */
export function transitionOrderOf(db: LedgerDb, o: StoredOrder): TransitionOrder {
  return { status: o.status, paidAt: o.paidAt, approvedCommission: o.approvedCommission, cashback: o.cashback, guest: isGuest(db, o.customerId) };
}

export interface LatestObservations {
  /** The fingerprint of the last row applied to the order; a row equal to it is skipped (AD-8). */
  readonly appliedFingerprint: string | null;
  /** The last row stored, applied or not. */
  readonly latest: { readonly fingerprint: string; readonly applied: boolean } | null;
}

export function latestObservations(db: LedgerDb, orderId: string): LatestObservations {
  const columns = { fingerprint: orderObservations.fingerprint, applied: orderObservations.applied };
  const latest = db.select(columns).from(orderObservations).where(eq(orderObservations.orderId, orderId)).orderBy(desc(orderObservations.id)).limit(1).get() ?? null;
  const applied =
    latest?.applied === true
      ? latest
      : db
          .select(columns)
          .from(orderObservations)
          .where(and(eq(orderObservations.orderId, orderId), eq(orderObservations.applied, true)))
          .orderBy(desc(orderObservations.id))
          .limit(1)
          .get();
  return { appliedFingerprint: applied?.fingerprint ?? null, latest };
}

export function insertObservation(db: LedgerDb, row: { orderId: string; observedAt: Instant; fingerprint: string; observation: string; applied: boolean }): void {
  db.insert(orderObservations).values(row).run();
}

export function touchLastSeen(db: LedgerDb, orderId: string, at: Instant): void {
  db.update(orders).set({ lastSeenInReportAt: at }).where(eq(orders.orderId, orderId)).run();
}

export interface ItemLine {
  readonly itemId: string;
  readonly status: ObservedStatus;
  /** The sum of the item's commission parts; null when the report gave none. */
  readonly commission: number | null;
  readonly value: number | null;
}

/** The order's items as the latest applied row reports them (R3); the imported placeholder line goes. */
export function replaceItems(db: LedgerDb, orderId: string, items: readonly ItemLine[]): void {
  db.delete(orderItems).where(eq(orderItems.orderId, orderId)).run();
  for (const [i, item] of items.entries()) {
    db.insert(orderItems)
      .values({
        orderId,
        lineNo: i + 1,
        itemId: item.itemId === "" ? null : item.itemId,
        price: item.value,
        estimatedCommission: item.commission,
        approvedCommission: item.status === "APPROVED" ? item.commission : null,
        networkStatus: item.status,
        origin: "REPORT",
      })
      .run();
  }
}

export interface ReviewCaseOpening {
  readonly network: AffiliateNetwork;
  readonly subject: string;
  readonly orderId: string | null;
  readonly reason: string;
  readonly candidates: readonly string[];
  readonly observation: string;
  readonly openedAt: Instant;
  readonly openedBy: string;
}

/** Opens a case unless one is already OPEN for the same network, subject and reason; returns its id when it opened one. */
export function openReviewCase(db: LedgerDb, c: ReviewCaseOpening): number | null {
  const result = db
    .insert(reviewCases)
    .values({ ...c, candidates: JSON.stringify(c.candidates), status: "OPEN" })
    .onConflictDoNothing()
    .run();
  return result.changes === 1 ? Number(result.lastInsertRowid) : null;
}
