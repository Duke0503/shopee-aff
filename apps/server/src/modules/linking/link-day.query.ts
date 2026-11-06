/**
 * The link requests made on one day, per customer id as stored, for the daily link report (D66):
 * requests the platform took itself (`origin` REQUEST), by their status at the time of this read.
 * Delivered or converted is a success, failed is a failure, queued or issued is still waiting. A
 * product asked again reuses its request (D6), so it counts once, on the day it was first asked. The
 * product text of a failed request is its looked-up name on one line, or the source link when that
 * leaves nothing.
 */
import type { InstantRange, LinkRequestStatus } from "@cashback/core";
import { and, asc, eq, gte, lt } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { linkRequests } from "./schema";

export interface CustomerLinkCounts {
  /** As stored on the requests; a merged record's id is not followed here. */
  readonly customerId: string;
  readonly requests: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly waiting: number;
  /** One per failed request, oldest first. */
  readonly failedProducts: readonly string[];
}

const OUTCOMES = { DELIVERED: "succeeded", CONVERTED: "succeeded", FAILED: "failed", QUEUED: "waiting", ISSUED: "waiting" } as const satisfies Record<LinkRequestStatus, "succeeded" | "failed" | "waiting">;

const productTextOf = (row: { productName: string | null; sourceUrl: string }): string => {
  const name = row.productName?.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").trim() ?? "";
  return name === "" ? row.sourceUrl : name;
};

export function linkCountsOfDay(db: LedgerDb, range: InstantRange): CustomerLinkCounts[] {
  const rows = db
    .select({ customerId: linkRequests.customerId, status: linkRequests.status, productName: linkRequests.productName, sourceUrl: linkRequests.sourceUrl })
    .from(linkRequests)
    .where(and(eq(linkRequests.origin, "REQUEST"), gte(linkRequests.createdAt, range.from), lt(linkRequests.createdAt, range.to)))
    .orderBy(asc(linkRequests.createdAt), asc(linkRequests.requestId))
    .all();
  const counts = new Map<string, CustomerLinkCounts>();
  for (const row of rows) {
    const before = counts.get(row.customerId) ?? { customerId: row.customerId, requests: 0, succeeded: 0, failed: 0, waiting: 0, failedProducts: [] };
    const outcome = OUTCOMES[row.status];
    counts.set(row.customerId, { ...before, requests: before.requests + 1, [outcome]: before[outcome] + 1, failedProducts: outcome === "failed" ? [...before.failedProducts, productTextOf(row)] : before.failedProducts });
  }
  return [...counts.values()];
}
