/**
 * R5 aging (AD-8, D43, status-flows.md §1; Stories 3.5 and 3.8), computed from
 * `last_seen_in_report_at`: an awaiting order the report has not shown for 14 days is flagged by a
 * `not_seen_in_report` review case, and one unseen for over 60 days counts as aged on the Overview.
 * An order never seen since the cutover ages from its purchase time; that is how an imported order
 * the report can no longer verify reaches staff. A flag never changes the order or its money.
 *
 * Only a network whose report was read successfully can say an order is missing from it: the
 * caller passes the networks it trusts tonight. When the order shows up in a report again, its
 * open case is resolved by the system with the outcome `seen_again` (`resolveSeenAgain`).
 */
import { instantFromMs, toMs, type Instant } from "@cashback/core";
import { and, eq, isNotNull, lte, sql } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import type { AffiliateNetwork } from "@cashback/money";

import { openOrRefreshCase, resolveOpenCase, type CaseWriters } from "./review-case.command";
import { orders } from "./schema";

export const FLAG_AFTER_DAYS = 14;
export const AGED_AFTER_DAYS = 60;
const DAY_MS = 86_400_000;

const lastSeen = sql<string | null>`coalesce(${orders.lastSeenInReportAt}, ${orders.recordedAt})`;
const daysBefore = (at: Instant, days: number): Instant => instantFromMs(toMs(at) - days * DAY_MS);

function awaitingUnseenSince(db: LedgerDb, since: Instant, inclusive: boolean) {
  return db
    .select({
      orderId: orders.orderId,
      network: orders.network,
      customerId: orders.customerId,
      lastSeenInReportAt: orders.lastSeenInReportAt,
      recordedAt: orders.recordedAt,
    })
    .from(orders)
    .where(and(eq(orders.status, "AWAITING_APPROVAL"), isNotNull(lastSeen), inclusive ? lte(lastSeen, since) : sql`${lastSeen} < ${since}`))
    .orderBy(orders.orderId)
    .all();
}

export interface AgingCounts {
  /** Awaiting orders not seen for 14 days or more. */
  readonly flagged: number;
  /** Awaiting orders not seen for over 60 days. */
  readonly aged: number;
}

export function orderAging(db: LedgerDb, at: Instant): AgingCounts {
  return {
    flagged: awaitingUnseenSince(db, daysBefore(at, FLAG_AFTER_DAYS), true).length,
    aged: awaitingUnseenSince(db, daysBefore(at, AGED_AFTER_DAYS), false).length,
  };
}

/** Opens (or keeps) one `not_seen_in_report` case per flagged order; call inside `tx`. Returns the cases opened. */
export function flagUnseenOrders(db: LedgerDb, w: CaseWriters, networks: readonly AffiliateNetwork[]): number {
  let opened = 0;
  for (const o of awaitingUnseenSince(db, daysBefore(w.at, FLAG_AFTER_DAYS), true)) {
    // review_cases.network is NOT NULL: an order of no network waits for its first row instead.
    if (o.network === null || !networks.includes(o.network)) continue;
    const observation = JSON.stringify({
      orderId: o.orderId,
      lastSeenInReportAt: o.lastSeenInReportAt,
      recordedAt: o.recordedAt,
    });
    const evidence = {
      network: o.network,
      subject: o.orderId,
      orderId: o.orderId,
      reason: "not_seen_in_report" as const,
      candidates: o.customerId === null ? [] : [o.customerId],
      observation,
      fingerprint: null,
    };
    if (openOrRefreshCase(db, evidence, w).write === "opened") opened++;
  }
  return opened;
}

/** The order was in a report again: its `not_seen_in_report` case, if open, is resolved `seen_again`. */
export function resolveSeenAgain(db: LedgerDb, orderId: string, w: CaseWriters): void {
  resolveOpenCase(db, orderId, "not_seen_in_report", "seen_again", w);
}
