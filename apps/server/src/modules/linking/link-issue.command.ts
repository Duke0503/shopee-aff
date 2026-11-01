/**
 * Claiming the next link submission (AD-14, D6, D47, INV-1; Stories 5.1, 5.5, 5.7), in its own
 * transaction, so the bridge or the AccessTrade API is awaited with no transaction open (code.md
 * §5). The result side is link-result.command.ts.
 *
 * `claimLinkWork` hands out the open LINK job an interrupted run left first, but only after
 * checking again that its request is still QUEUED and its customer still resolves to the same
 * sub_id1; a job that no longer holds is closed without reaching the bridge. Otherwise it takes
 * the oldest QUEUED request that is due, by priority (Zalo, then web, then the guest account). A
 * Shopee request gets one LINK bridge job: one request, so one customer, with sub_id1 = that
 * customer's id (the `DEV` prefix in dev, AD-25) and sub_id2 = the request id. A TikTok Shop
 * request is handed back as AccessTrade API work with the same two sub_ids and no bridge job. A
 * request whose customer no longer resolves (erased since) is FAILED instead. Imported (CUTOVER)
 * requests are history and are not served again.
 *
 * While the Shopee queue is held or paused (Story 5.5) no Shopee job is handed out, open or new;
 * AccessTrade requests, which never reach the browser, are still served.
 */
import type { Clock } from "@cashback/core";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import type { LinkBridgeJob } from "../../platform/ports/bridge.port";
import { resolveCustomer } from "../identity/index";
import { SUB_ID_PATTERN } from "./domain/product-url";
import { shopeeQueueGate } from "./link-queue.command";
import { bridgeJobs, linkRequests, type LinkNetwork } from "./schema";

export interface ClaimOptions {
  /** `DEV` in dev, empty in production (AD-25). */
  readonly subIdPrefix: string;
  /** The guest account ids, read once per run (D5). */
  readonly guestIds: readonly string[];
}

/** One AccessTrade link to make over its API (Story 5.7): sub1 = sub_id1, sub2 = the request id. */
export interface ApiLinkRequest {
  readonly network: "accesstrade";
  readonly requestId: string;
  readonly sourceUrl: string;
  readonly subId1: string;
  readonly subId2: string;
}

export type LinkWork = { readonly kind: "bridge"; readonly job: LinkBridgeJob } | { readonly kind: "api"; readonly request: ApiLinkRequest };

export const closeJob = (db: LedgerDb, jobId: number, failure: string, at: string): void => {
  db.update(bridgeJobs).set({ status: "FAILED", failure, finishedAt: at }).where(eq(bridgeJobs.jobId, jobId)).run();
};

const failRequest = (db: LedgerDb, requestId: string): void => {
  db.update(linkRequests).set({ status: "FAILED" }).where(eq(linkRequests.requestId, requestId)).run();
};

/** The sub_id1 a request's customer gets now, or null when nobody resolves (erased, gone). */
function subId1Of(db: LedgerDb, customerId: string, prefix: string): { customerId: string; subId1: string } | null {
  const owner = resolveCustomer(db, customerId);
  if (owner === null || !SUB_ID_PATTERN.test(owner.customerId)) return null;
  return { customerId: owner.customerId, subId1: `${prefix}${owner.customerId}` };
}

/** The oldest open LINK job that still holds; every one that does not is closed on the way. */
function resumableJob(db: LedgerDb, clock: Clock, prefix: string): LinkBridgeJob | null {
  for (;;) {
    const row = db
      .select({ jobId: bridgeJobs.jobId, requestId: bridgeJobs.requestId, sourceUrl: bridgeJobs.sourceUrl, subId1: bridgeJobs.subId1, subId2: bridgeJobs.subId2, status: linkRequests.status, customerId: linkRequests.customerId })
      .from(bridgeJobs)
      .innerJoin(linkRequests, eq(linkRequests.requestId, bridgeJobs.requestId))
      .where(and(eq(bridgeJobs.kind, "LINK"), eq(bridgeJobs.status, "PENDING")))
      .orderBy(asc(bridgeJobs.jobId))
      .get();
    if (!row) return null;
    const { requestId, sourceUrl, subId1, subId2 } = row;
    const owner = subId1Of(db, row.customerId, prefix);
    if (row.status === "QUEUED" && owner !== null && owner.subId1 === subId1 && requestId !== null && sourceUrl !== null && subId1 !== null && subId2 !== null) {
      return { jobId: row.jobId, requestId, sourceUrl, subId1, subId2 };
    }
    closeJob(db, row.jobId, "stale", clock.now());
    if (row.status === "QUEUED" && owner === null && requestId !== null) failRequest(db, requestId);
  }
}

interface QueuedRow {
  readonly requestId: string;
  readonly customerId: string;
  readonly sourceUrl: string;
  readonly network: LinkNetwork;
}

/** The next due QUEUED request of `networks` in service order: Zalo (and the live private chat) 0, web 1, guest 2. */
function nextQueued(db: LedgerDb, guestIds: readonly string[], now: string, networks: readonly LinkNetwork[]): QueuedRow | null {
  const guest = guestIds.length === 0 ? sql`0` : sql`${linkRequests.customerId} IN (${sql.join(guestIds.map((g) => sql`${g}`), sql`, `)})`;
  const priority = sql`CASE WHEN ${guest} THEN 2 WHEN ${linkRequests.channel} = 'web' THEN 1 ELSE 0 END`;
  const network = sql<LinkNetwork>`coalesce(${linkRequests.network}, 'shopee')`;
  const row = db
    .select({ requestId: linkRequests.requestId, customerId: linkRequests.customerId, sourceUrl: linkRequests.sourceUrl, network })
    .from(linkRequests)
    .where(and(eq(linkRequests.status, "QUEUED"), eq(linkRequests.origin, "REQUEST"), inArray(network, [...networks]), or(isNull(linkRequests.nextAttemptAt), lte(linkRequests.nextAttemptAt, now))))
    .orderBy(priority, asc(linkRequests.createdAt), asc(linkRequests.requestId))
    .get();
  return row ?? null;
}

/** Claims the next submission, bridge or API; call inside `tx`. Null when nothing is due. */
export function claimLinkWork(db: LedgerDb, clock: Clock, options: ClaimOptions, networks: readonly LinkNetwork[] = ["shopee", "accesstrade"]): LinkWork | null {
  const now = clock.now();
  const shopeeOpen = networks.includes("shopee") && shopeeQueueGate(db, now) === "open";
  if (shopeeOpen) {
    const open = resumableJob(db, clock, options.subIdPrefix);
    if (open !== null) return { kind: "bridge", job: open };
  }
  const served = networks.filter((n) => n !== "shopee" || shopeeOpen);
  if (served.length === 0) return null;
  for (let request = nextQueued(db, options.guestIds, now, served); request !== null; request = nextQueued(db, options.guestIds, now, served)) {
    const owner = subId1Of(db, request.customerId, options.subIdPrefix);
    if (owner === null) {
      failRequest(db, request.requestId);
      continue;
    }
    if (request.network === "accesstrade") return { kind: "api", request: { network: "accesstrade", requestId: request.requestId, sourceUrl: request.sourceUrl, subId1: owner.subId1, subId2: request.requestId } };
    const inserted = db
      .insert(bridgeJobs)
      .values({ kind: "LINK", status: "PENDING", requestId: request.requestId, customerId: owner.customerId, subId1: owner.subId1, subId2: request.requestId, sourceUrl: request.sourceUrl, createdAt: now })
      .returning({ jobId: bridgeJobs.jobId })
      .get();
    return { kind: "bridge", job: { jobId: inserted.jobId, requestId: request.requestId, sourceUrl: request.sourceUrl, subId1: owner.subId1, subId2: request.requestId } };
  }
  return null;
}

/** The next Shopee bridge job only; call inside `tx`. Null when nothing is due or the queue is held or paused. */
export function claimLinkJob(db: LedgerDb, clock: Clock, options: ClaimOptions): LinkBridgeJob | null {
  const work = claimLinkWork(db, clock, options, ["shopee"]);
  return work?.kind === "bridge" ? work.job : null;
}
