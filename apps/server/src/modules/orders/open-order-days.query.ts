/**
 * The Vietnam days the nightly sweep must read (AD-8, D43, R5; Story 3.8): every purchase day that
 * still holds an unresolved order of the network, AWAITING_APPROVAL, FROZEN or APPROVED unpaid.
 * An imported order whose network is not known yet counts for every network, since its first
 * report row names it. Days come least recently seen first, so a sweep cut short by its deadline
 * reads the stalest days and the next night continues with the rest. An order without a purchase
 * time cannot be placed on a day and is counted apart.
 */
import { vnDateOf, type Instant, type VnDate } from "@cashback/core";
import type { AffiliateNetwork } from "@cashback/money";
import { and, eq, inArray, isNull, or } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { orders } from "./schema";

export interface OpenOrderDay {
  readonly day: VnDate;
  readonly orders: number;
  /** The earliest last-seen time among the day's orders; null when one was never seen. */
  readonly oldestSeen: Instant | null;
}

export interface OpenOrderDays {
  readonly days: readonly OpenOrderDay[];
  /** Unresolved orders with no purchase time. */
  readonly unplaced: number;
}

const unresolved = or(inArray(orders.status, ["AWAITING_APPROVAL", "FROZEN"]), and(eq(orders.status, "APPROVED"), isNull(orders.paidAt)));

const seenBefore = (a: Instant | null, b: Instant | null): boolean => a === null || (b !== null && a < b);

export function openOrderDays(db: LedgerDb, network: AffiliateNetwork): OpenOrderDays {
  const rows = db
    .select({ recordedAt: orders.recordedAt, lastSeen: orders.lastSeenInReportAt })
    .from(orders)
    .where(and(unresolved, or(eq(orders.network, network), isNull(orders.network))))
    .all();
  const byDay = new Map<VnDate, { orders: number; oldestSeen: Instant | null; anyUnseen: boolean }>();
  let unplaced = 0;
  for (const row of rows) {
    if (row.recordedAt === null) {
      unplaced++;
      continue;
    }
    const day = vnDateOf(row.recordedAt as Instant);
    const lastSeen = row.lastSeen as Instant | null;
    const entry = byDay.get(day) ?? { orders: 0, oldestSeen: lastSeen, anyUnseen: false };
    entry.orders++;
    if (lastSeen === null) entry.anyUnseen = true;
    else if (entry.oldestSeen === null || lastSeen < entry.oldestSeen) entry.oldestSeen = lastSeen;
    byDay.set(day, entry);
  }
  const days = [...byDay].map(([day, e]) => ({
    day,
    orders: e.orders,
    oldestSeen: e.anyUnseen ? null : e.oldestSeen,
  }));
  days.sort((a, b) => (a.oldestSeen === b.oldestSeen ? (a.day < b.day ? -1 : 1) : seenBefore(a.oldestSeen, b.oldestSeen) ? -1 : 1));
  return { days, unplaced };
}
