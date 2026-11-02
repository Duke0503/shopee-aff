/**
 * The linking module's part of the Overview (FR-25, docs/operations/dashboard-spec.md): link
 * requests delivered in a period, per network (the orders block's time base, by `delivered_at`),
 * and link requests that failed in a period (the "failed links today" to-do, by `created_at`: a
 * failed request records no time of its own), and the requests still waiting for the bridge (the
 * health model's queue depth, Story 8.3). Counts only.
 */
import type { Instant, InstantRange } from "@cashback/core";
import { and, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { linkRequests, type LinkNetwork } from "./schema";

export interface NetworkCount {
  readonly network: LinkNetwork | null;
  readonly count: number;
}

export function deliveredLinkCounts(db: LedgerDb, range: InstantRange): NetworkCount[] {
  return db
    .select({ network: linkRequests.network, count: sql<number>`count(*)` })
    .from(linkRequests)
    .where(and(isNotNull(linkRequests.deliveredAt), gte(linkRequests.deliveredAt, range.from), lt(linkRequests.deliveredAt, range.to)))
    .groupBy(linkRequests.network)
    .all();
}

export function failedLinkCount(db: LedgerDb, range: InstantRange): number {
  return db.select({ n: sql<number>`count(*)` }).from(linkRequests).where(and(eq(linkRequests.status, "FAILED"), gte(linkRequests.createdAt, range.from), lt(linkRequests.createdAt, range.to))).get()?.n ?? 0;
}

export interface WaitingLinks {
  readonly count: number;
  /** When the oldest waiting request was made, or null when none waits. */
  readonly oldestAt: string | null;
}

/** Link requests still QUEUED, and the oldest one's time. */
export function waitingLinkRequests(db: LedgerDb): WaitingLinks {
  const row = db
    .select({ n: sql<number>`count(*)`, oldest: sql<string | null>`min(${linkRequests.createdAt})` })
    .from(linkRequests)
    .where(eq(linkRequests.status, "QUEUED"))
    .get();
  return { count: row?.n ?? 0, oldestAt: row?.oldest ?? null };
}

/**
 * Since when the longest-waiting QUEUED request on one of `networks` has been due: a request in a
 * retry wait (`next_attempt_at` still ahead) is not due, and one is due from the later of its
 * creation and its retry time. Null when none is due.
 */
export function oldestDueLinkRequest(db: LedgerDb, now: Instant, networks: readonly LinkNetwork[]): string | null {
  if (networks.length === 0) return null;
  const dueSince = sql<string | null>`min(coalesce(max(${linkRequests.nextAttemptAt}, ${linkRequests.createdAt}), ${linkRequests.nextAttemptAt}, ${linkRequests.createdAt}))`;
  const row = db
    .select({ since: dueSince })
    .from(linkRequests)
    .where(and(eq(linkRequests.status, "QUEUED"), inArray(linkRequests.network, [...networks]), or(isNull(linkRequests.nextAttemptAt), lte(linkRequests.nextAttemptAt, now))))
    .get();
  return row?.since ?? null;
}
