/**
 * The owner of a link request (AD-8, D47): sub_id2 of a report row is the request id, and
 * attribution falls back to the customer stored on that request when sub_id1 is empty. The
 * request's platform is the shop the order came from.
 */
import { and, desc, eq, isNotNull } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { bridgeJobs, linkRequests } from "./schema";

export interface LinkRequestOwner {
  readonly requestId: string;
  /** The customer id stored on the request; it may no longer resolve to anyone. */
  readonly customerId: string;
  readonly platform: string;
}

export function findLinkRequestOwner(db: LedgerDb, requestId: string): LinkRequestOwner | null {
  if (requestId.trim() === "") return null;
  const row = db
    .select({ requestId: linkRequests.requestId, customerId: linkRequests.customerId, platform: linkRequests.platform })
    .from(linkRequests)
    .where(eq(linkRequests.requestId, requestId))
    .get();
  return row ?? null;
}

/** The request's status, or null for an unknown request. */
export function linkRequestStatusOf(db: LedgerDb, requestId: string): string | null {
  return db.select({ status: linkRequests.status }).from(linkRequests).where(eq(linkRequests.requestId, requestId)).get()?.status ?? null;
}

/**
 * When the browser last made a link, or null. A link job is the one bridge job only the browser can
 * finish: a lookup also ends DONE from the third party or from shared facts, which says nothing about
 * the session (D69).
 */
export function lastBrowserLinkAt(db: LedgerDb): string | null {
  return db.select({ finishedAt: bridgeJobs.finishedAt }).from(bridgeJobs).where(and(eq(bridgeJobs.kind, "LINK"), eq(bridgeJobs.status, "DONE"), isNotNull(bridgeJobs.resultUrl))).orderBy(desc(bridgeJobs.finishedAt)).limit(1).get()?.finishedAt ?? null;
}

/** Who asked and for what, for an owner alert about one request (D65). */
export function linkRequestSubjectOf(db: LedgerDb, requestId: string): { customerId: string; productName: string | null; sourceUrl: string } | null {
  return db.select({ customerId: linkRequests.customerId, productName: linkRequests.productName, sourceUrl: linkRequests.sourceUrl }).from(linkRequests).where(eq(linkRequests.requestId, requestId)).get() ?? null;
}
