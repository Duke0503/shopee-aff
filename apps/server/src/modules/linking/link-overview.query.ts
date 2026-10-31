/**
 * The linking module's part of the Overview (FR-25, docs/operations/dashboard-spec.md): link
 * requests delivered in a period, per network (the orders block's time base, by `delivered_at`),
 * and link requests that failed in a period (the "failed links today" to-do, by `created_at`: a
 * failed request records no time of its own). Counts only.
 */
import type { InstantRange } from "@cashback/core";
import { and, eq, gte, isNotNull, lt, sql } from "drizzle-orm";

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
