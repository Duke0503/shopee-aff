/**
 * The two writes around one bridge submission (AD-14, D6, D47, INV-1; Story 5.1), each its own
 * transaction so the bridge is awaited with no transaction open (code.md §5).
 *
 * `claimLinkJob` hands out the open LINK job an interrupted run left first, but only after
 * checking again that its request is still QUEUED and its customer still resolves to the same
 * sub_id1; a job that no longer holds is closed without reaching the bridge. Otherwise it takes
 * the oldest QUEUED request that is due, by priority (Zalo, then web, then the guest account), and
 * writes one LINK bridge job for it: one request, so one customer, with sub_id1 = that customer's
 * id (the `DEV` prefix in dev, AD-25) and sub_id2 = the request id. A request whose customer no
 * longer resolves (erased since) is FAILED instead. Imported (CUTOVER) requests are history and
 * are not served again.
 *
 * `recordLinkResult` closes the job. A returned link is attached only when it is on an allowed
 * host and carries exactly the job's sub_id1 and sub_id2; then the request becomes ISSUED with a
 * new 10-character base62 share code. A failure or a link that fails the check counts one attempt
 * and puts the request back with a growing delay, so a failing request never holds up the ones
 * behind it (the three-failure rule is Story 5.5). `recordSilentBridge` counts a browser that took
 * the job and went silent: uncounted once, a failed attempt the second time in a row.
 */
import { randomInt } from "node:crypto";
import { instantFromMs, toMs, type Clock, type Instant } from "@cashback/core";
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import type { BridgeLinkResult, LinkBridgeJob } from "../../platform/ports/bridge.port";
import { resolveCustomer } from "../identity/index";
import { checkReturnedLink, retryDelayMs } from "./domain/link-check";
import { SUB_ID_PATTERN } from "./domain/product-url";
import { bridgeJobs, linkRequests, shareCodes } from "./schema";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const SHARE_CODE_LENGTH = 10;

/** A new share code: 10 base62 characters, each drawn uniformly. */
export function randomShareCode(): string {
  let code = "";
  for (let i = 0; i < SHARE_CODE_LENGTH; i++) code += BASE62[randomInt(BASE62.length)];
  return code;
}

export interface ClaimOptions {
  /** `DEV` in dev, empty in production (AD-25). */
  readonly subIdPrefix: string;
  /** The guest account ids, read once per run (D5). */
  readonly guestIds: readonly string[];
}

const closeJob = (db: LedgerDb, jobId: number, failure: string, at: string): void => {
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

/** The next due QUEUED request in service order: Zalo (and the live private chat) 0, web 1, guest 2. */
function nextQueued(db: LedgerDb, guestIds: readonly string[], now: string): { requestId: string; customerId: string; sourceUrl: string } | null {
  const guest = guestIds.length === 0 ? sql`0` : sql`${linkRequests.customerId} IN (${sql.join(guestIds.map((g) => sql`${g}`), sql`, `)})`;
  const priority = sql`CASE WHEN ${guest} THEN 2 WHEN ${linkRequests.channel} = 'web' THEN 1 ELSE 0 END`;
  const row = db
    .select({ requestId: linkRequests.requestId, customerId: linkRequests.customerId, sourceUrl: linkRequests.sourceUrl })
    .from(linkRequests)
    .where(and(eq(linkRequests.status, "QUEUED"), eq(linkRequests.origin, "REQUEST"), or(isNull(linkRequests.nextAttemptAt), lte(linkRequests.nextAttemptAt, now))))
    .orderBy(priority, asc(linkRequests.createdAt), asc(linkRequests.requestId))
    .get();
  return row ?? null;
}

/** Claims the next submission; call inside `tx`. Null when nothing is due. */
export function claimLinkJob(db: LedgerDb, clock: Clock, options: ClaimOptions): LinkBridgeJob | null {
  const open = resumableJob(db, clock, options.subIdPrefix);
  if (open !== null) return open;
  const now = clock.now();
  for (let request = nextQueued(db, options.guestIds, now); request !== null; request = nextQueued(db, options.guestIds, now)) {
    const owner = subId1Of(db, request.customerId, options.subIdPrefix);
    if (owner === null) {
      failRequest(db, request.requestId);
      continue;
    }
    const inserted = db
      .insert(bridgeJobs)
      .values({ kind: "LINK", status: "PENDING", requestId: request.requestId, customerId: owner.customerId, subId1: owner.subId1, subId2: request.requestId, sourceUrl: request.sourceUrl, createdAt: now })
      .returning({ jobId: bridgeJobs.jobId })
      .get();
    return { jobId: inserted.jobId, requestId: request.requestId, sourceUrl: request.sourceUrl, subId1: owner.subId1, subId2: request.requestId };
  }
  return null;
}

function newShareCode(db: LedgerDb, makeCode: () => string): string {
  for (let tries = 0; tries < 5; tries++) {
    const code = makeCode();
    if (!db.select({ code: shareCodes.code }).from(shareCodes).where(eq(shareCodes.code, code)).get()) return code;
  }
  throw new Error("linking: no free share code after 5 tries");
}

export interface LinkResultRecorded {
  readonly requestId: string;
  readonly outcome: "issued" | "failed" | "stale";
  /** Why a submission failed: the bridge's reason or the link check's. */
  readonly reason: string | null;
  readonly shareCode: string | null;
}

export interface RecordOptions {
  /** True only for the fake bridge's own links (AD-25). */
  readonly acceptFakeHost: boolean;
  readonly makeCode?: () => string;
}

/** Counts one failed attempt and puts the request back after its delay. */
function backOff(db: LedgerDb, requestId: string, at: Instant): void {
  const row = db.select({ attempts: linkRequests.attempts }).from(linkRequests).where(eq(linkRequests.requestId, requestId)).get();
  const attempts = (row?.attempts ?? 0) + 1;
  db.update(linkRequests).set({ attempts, nextAttemptAt: instantFromMs(toMs(at) + retryDelayMs(attempts)) }).where(eq(linkRequests.requestId, requestId)).run();
}

/** Times in a row the browser may take one job and go silent before that counts as a failed attempt. */
export const SILENT_ANSWERS_BEFORE_FAILURE = 2;

/**
 * The browser took this job and never answered (Story 5.3 review item 2); call inside `tx`. The
 * first time the job stays open and uncounted (a browser restart is not the request's fault); the
 * second time in a row it is closed `bridge_no_answer` and the request backs off like any failure,
 * so a page that always silences the bridge cannot hold the queue.
 */
export function recordSilentBridge(db: LedgerDb, job: LinkBridgeJob, clock: Clock): "retry" | "failed" {
  const row = db.select({ status: bridgeJobs.status, noAnswers: bridgeJobs.noAnswers }).from(bridgeJobs).where(eq(bridgeJobs.jobId, job.jobId)).get();
  if (row?.status !== "PENDING") return "retry";
  const noAnswers = row.noAnswers + 1;
  db.update(bridgeJobs).set({ noAnswers }).where(eq(bridgeJobs.jobId, job.jobId)).run();
  if (noAnswers < SILENT_ANSWERS_BEFORE_FAILURE) return "retry";
  const at = clock.now();
  closeJob(db, job.jobId, "bridge_no_answer", at);
  backOff(db, job.requestId, at);
  return "failed";
}

/** An answer that closes the job; `unavailable` leaves it open and is never recorded. */
export type RecordedBridgeAnswer = Exclude<BridgeLinkResult, { outcome: "unavailable" }>;

/** Closes a claimed job with the bridge's answer; call inside `tx`. */
export function recordLinkResult(db: LedgerDb, job: LinkBridgeJob, result: RecordedBridgeAnswer, clock: Clock, options: RecordOptions): LinkResultRecorded {
  const at = clock.now();
  const done = (outcome: LinkResultRecorded["outcome"], reason: string | null = null, shareCode: string | null = null): LinkResultRecorded => ({ requestId: job.requestId, outcome, reason, shareCode });
  const open = db.select({ status: bridgeJobs.status }).from(bridgeJobs).where(eq(bridgeJobs.jobId, job.jobId)).get();
  const request = db.select({ status: linkRequests.status }).from(linkRequests).where(eq(linkRequests.requestId, job.requestId)).get();
  if (open?.status !== "PENDING") return done("stale");
  if (request?.status !== "QUEUED") {
    // The request was settled meanwhile; the answer is dropped and the job closed so it is not handed out again.
    closeJob(db, job.jobId, "stale", at);
    return done("stale");
  }
  const reason = result.outcome === "failed" ? result.reason : linkFailure(job, result, options);
  if (reason !== null || result.outcome === "failed") {
    const why = reason ?? "failed";
    closeJob(db, job.jobId, why, at);
    backOff(db, job.requestId, at);
    return done("failed", why);
  }
  const url = result.url;
  const shareCode = newShareCode(db, options.makeCode ?? randomShareCode);
  db.update(bridgeJobs).set({ status: "DONE", resultUrl: url, finishedAt: at }).where(eq(bridgeJobs.jobId, job.jobId)).run();
  db.update(linkRequests).set({ status: "ISSUED", affiliateUrl: url, attempts: sql`${linkRequests.attempts} + 1`, nextAttemptAt: null }).where(eq(linkRequests.requestId, job.requestId)).run();
  db.insert(shareCodes).values({ code: shareCode, requestId: job.requestId, createdAt: at }).run();
  return done("issued", null, shareCode);
}

function linkFailure(job: LinkBridgeJob, result: Extract<RecordedBridgeAnswer, { outcome: "link" }>, options: RecordOptions): string | null {
  const check = checkReturnedLink({ url: result.url, resolvedUrl: result.resolvedUrl ?? null, subId1: job.subId1, subId2: job.subId2, acceptFakeHost: options.acceptFakeHost });
  return check.ok ? null : `link_${check.reason}`;
}
