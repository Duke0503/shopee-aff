/**
 * Recording a link submission's answer (AD-14, AD-16, AD-27, D6, D47, INV-1; Stories 5.1, 5.4,
 * 5.5, 5.7), in one transaction after the bridge or the AccessTrade API answered. Both go through
 * one `settle`: only the closing of a bridge job differs.
 *
 * A returned link is attached only when it passes `checkReturnedLink`: a bridge link must be on a
 * Shopee host and carry exactly the job's sub_id1 and sub_id2 (a short link through the resolved
 * link the bridge answered with it); an AccessTrade link must be on an AccessTrade host and carry
 * no other sub_ids. Then the request becomes ISSUED with a new 10-character base62 share code.
 *
 * A failure, or a link that fails the check, counts one attempt and puts the request back with a
 * growing delay, so a failing request never holds up the ones behind it. The third counted failure
 * fails the request (FAILED) and enqueues the "link failed" message for its customer; the outbox
 * tells no guest (D5). The failures that are not counted are listed in domain/link-failure.ts.
 */
import { randomInt } from "node:crypto";
import { instantFromMs, toMs, type Clock, type Instant } from "@cashback/core";
import { eq, sql } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import type { AlertPort } from "../../platform/ports/alert.port";
import type { BridgeLinkResult, LinkBridgeJob } from "../../platform/ports/bridge.port";
import { dedupKey, type OutboxPort } from "../../platform/ports/outbox.port";
import { checkReturnedLink, needsResolution, retryDelayMs, shopKeyFromTarget, type LinkOrigin } from "./domain/link-check";
import { handlingOf, LINK_MAX_ATTEMPTS, LINK_QUEUE_ALERTS, PAGE_ERROR_HOLD_MS, pageErrorStep } from "./domain/link-failure";
import { closeJob, type ApiLinkRequest } from "./link-issue.command";
import { holdShopeeQueue, notePageError, pauseShopeeQueue, shopeeQueueState } from "./link-queue.command";
import { bridgeJobs, linkRequests, shareCodes } from "./schema";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const SHARE_CODE_LENGTH = 10;

/** The message key of the "link failed" notification (packages/labels/vi/messages.json). */
export const LINK_FAILED_MESSAGE = "link_failed";

/** A new share code: 10 base62 characters, each drawn uniformly. */
export function randomShareCode(): string {
  let code = "";
  for (let i = 0; i < SHARE_CODE_LENGTH; i++) code += BASE62[randomInt(BASE62.length)];
  return code;
}

/** The outbox and alert ports bound to the result's own transaction (the composition root builds them). */
export interface LinkEffects {
  readonly outbox: OutboxPort;
  readonly alerts: AlertPort;
}

export interface RecordOptions {
  /** True only for the fake bridge's (or the fake AccessTrade creator's) own links (AD-25). */
  readonly acceptFakeHost: boolean;
  readonly effects: (db: LedgerDb) => LinkEffects;
  readonly makeCode?: () => string;
}

export interface LinkResultRecorded {
  readonly requestId: string;
  /** `held`, `paused` and `retry`: not counted (Story 5.5); `retry` backed only this request off. */
  readonly outcome: "issued" | "failed" | "held" | "paused" | "retry" | "stale";
  /** Why a submission failed: the bridge's reason, the API's or the link check's. */
  readonly reason: string | null;
  readonly shareCode: string | null;
  /** True when the request is now FAILED and its customer told. */
  readonly requestFailed: boolean;
  /** The browser's resolved source could not belong to this request and set no key (Story 5.11 review item 10). */
  readonly sourceTargetIgnored?: boolean;
}

/** One submission as `settle` sees it: whose sub_ids, who made the link and the bridge job, if any. */
interface Submission {
  readonly requestId: string;
  readonly subId1: string;
  readonly subId2: string;
  readonly origin: LinkOrigin;
  readonly jobId: number | null;
}

/** A link with what came back with it, or a failure. */
type SubmissionAnswer =
  | { readonly outcome: "link"; readonly url: string; readonly resolvedUrl?: string | null; readonly sourceTarget?: string | null; readonly echoedSubIds?: { readonly sub1: string | null; readonly sub2: string | null } }
  | { readonly outcome: "failed"; readonly reason: string };

function newShareCode(db: LedgerDb, makeCode: () => string): string {
  for (let tries = 0; tries < 5; tries++) {
    const code = makeCode();
    if (!db.select({ code: shareCodes.code }).from(shareCodes).where(eq(shareCodes.code, code)).get()) return code;
  }
  throw new Error("linking: no free share code after 5 tries");
}

const requestOf = (db: LedgerDb, requestId: string) =>
  db.select({ status: linkRequests.status, attempts: linkRequests.attempts, customerId: linkRequests.customerId, pageErrors: linkRequests.pageErrors, pageErrorSince: linkRequests.pageErrorSince }).from(linkRequests).where(eq(linkRequests.requestId, requestId)).get();

/** FAILED now, and the customer told once (never a guest: the outbox refuses it). */
function failRequest(db: LedgerDb, requestId: string, customerId: string, messageKey: string, effects: LinkEffects, attempts?: number): void {
  db.update(linkRequests).set({ status: "FAILED", nextAttemptAt: null, ...(attempts === undefined ? {} : { attempts }) }).where(eq(linkRequests.requestId, requestId)).run();
  effects.outbox.enqueue({ dedupKey: dedupKey("link_request", requestId, "failed"), customerId, messageKey, params: { requestId } });
}

/** Counts one failed attempt; the third fails the request and tells its customer, else it backs off. True when FAILED. */
function countFailure(db: LedgerDb, requestId: string, at: Instant, effects: LinkEffects): boolean {
  const row = requestOf(db, requestId);
  const attempts = (row?.attempts ?? 0) + 1;
  if (row === undefined || attempts < LINK_MAX_ATTEMPTS) {
    db.update(linkRequests).set({ attempts, nextAttemptAt: instantFromMs(toMs(at) + retryDelayMs(attempts)) }).where(eq(linkRequests.requestId, requestId)).run();
    return false;
  }
  failRequest(db, requestId, row.customerId, LINK_FAILED_MESSAGE, effects, attempts);
  return true;
}

const backOffUncounted = (db: LedgerDb, requestId: string, until: Instant): void => {
  db.update(linkRequests).set({ nextAttemptAt: until }).where(eq(linkRequests.requestId, requestId)).run();
};

/** A page error (review item 1): hold the queue, back this request off, or fail it after 30 minutes. */
function pageError(db: LedgerDb, requestId: string, at: Instant, effects: LinkEffects): LinkResultRecorded["outcome"] {
  const row = requestOf(db, requestId);
  if (row === undefined) return "stale";
  const since = (row.pageErrorSince as Instant | null) ?? at;
  const step = pageErrorStep({ requestId, lastPageErrorRequest: shopeeQueueState(db).lastPageErrorRequest, since: row.pageErrorSince as Instant | null, now: at });
  const pageErrors = row.pageErrors + 1;
  db.update(linkRequests).set({ pageErrors, pageErrorSince: since }).where(eq(linkRequests.requestId, requestId)).run();
  notePageError(db, requestId);
  if (step === "fail") {
    failRequest(db, requestId, row.customerId, LINK_FAILED_MESSAGE, effects);
    return "failed";
  }
  if (step === "back_off") {
    backOffUncounted(db, requestId, instantFromMs(toMs(at) + retryDelayMs(pageErrors)));
    return "retry";
  }
  holdShopeeQueue(db, "page_error", instantFromMs(toMs(at) + PAGE_ERROR_HOLD_MS));
  effects.alerts.alert(LINK_QUEUE_ALERTS.page_error.kind, LINK_QUEUE_ALERTS.page_error.severity);
  return "held";
}

/** Every failure not counted or counted, by its handling; the outcome and whether the request is now FAILED. */
function settleFailure(db: LedgerDb, sub: Submission, reason: string, at: Instant, effects: LinkEffects): { outcome: LinkResultRecorded["outcome"]; requestFailed: boolean } {
  const handling = handlingOf(reason);
  if (handling.kind === "page_error") {
    const outcome = pageError(db, sub.requestId, at, effects);
    return { outcome, requestFailed: outcome === "failed" };
  }
  if (sub.origin === "bridge") notePageError(db, null);
  switch (handling.kind) {
    case "counted":
      return { outcome: "failed", requestFailed: countFailure(db, sub.requestId, at, effects) };
    case "hold":
      holdShopeeQueue(db, handling.reason, instantFromMs(toMs(at) + handling.ms));
      effects.alerts.alert(LINK_QUEUE_ALERTS.captcha.kind, LINK_QUEUE_ALERTS.captcha.severity);
      return { outcome: "held", requestFailed: false };
    case "pause":
      if (pauseShopeeQueue(db, handling.reason, at)) effects.alerts.alert(LINK_QUEUE_ALERTS.login_redirect.kind, LINK_QUEUE_ALERTS.login_redirect.severity);
      return { outcome: "paused", requestFailed: false };
    case "outage":
      backOffUncounted(db, sub.requestId, instantFromMs(toMs(at) + handling.ms));
      effects.alerts.alert(LINK_QUEUE_ALERTS.link_unresolved.kind, LINK_QUEUE_ALERTS.link_unresolved.severity);
      return { outcome: "retry", requestFailed: false };
    case "final": {
      const row = requestOf(db, sub.requestId);
      if (row !== undefined) failRequest(db, sub.requestId, row.customerId, handling.messageKey, effects, row.attempts + 1);
      return { outcome: "failed", requestFailed: true };
    }
  }
}

/** Why a returned link is not attached, or null: an unresolved short link is an outage, not a check failure. */
function linkFailure(sub: Submission, answer: Extract<SubmissionAnswer, { outcome: "link" }>, acceptFakeHost: boolean): string | null {
  if (sub.origin === "bridge" && needsResolution(answer.url) && !answer.resolvedUrl) return "link_unresolved";
  const check = checkReturnedLink({ url: answer.url, resolvedUrl: answer.resolvedUrl ?? null, subId1: sub.subId1, subId2: sub.subId2, acceptFakeHost, origin: sub.origin, ...(answer.echoedSubIds ? { echoedSubIds: answer.echoedSubIds } : {}) });
  return check.ok ? null : `link_${check.reason}`;
}

/**
 * A ShopeeFood request made from a short link learns its shop only from the browser that resolved
 * it (Story 5.11, D8): its reuse key `shopeefood:<shopId>` is set from that target when the target
 * can belong to this request (`shopKeyFromTarget`), so the next link to the same shop reuses it. A
 * key the request already has is never replaced; a target that cannot belong is ignored and
 * reported in the result for the job's log line.
 */
function learnedShopKey(db: LedgerDb, requestId: string, sourceTarget: string | null | undefined): { key: string | null; ignored: boolean } {
  if (!sourceTarget) return { key: null, ignored: false };
  const row = db.select({ sourceUrl: linkRequests.sourceUrl, platform: linkRequests.platform, productKey: linkRequests.productKey }).from(linkRequests).where(eq(linkRequests.requestId, requestId)).get();
  if (row === undefined || row.platform !== "shopeefood" || row.productKey !== null) return { key: null, ignored: false };
  const check = shopKeyFromTarget(row.sourceUrl, sourceTarget);
  return check.kind === "key" ? { key: check.productKey, ignored: false } : { key: null, ignored: check.kind === "ignored" };
}

/** The one recording of an answer, for the bridge and the API alike; call inside `tx`. */
function settle(db: LedgerDb, sub: Submission, answer: SubmissionAnswer, clock: Clock, options: RecordOptions): LinkResultRecorded {
  const at = clock.now();
  const done = (outcome: LinkResultRecorded["outcome"], reason: string | null = null, shareCode: string | null = null, requestFailed = false): LinkResultRecorded => ({ requestId: sub.requestId, outcome, reason, shareCode, requestFailed });
  if (requestOf(db, sub.requestId)?.status !== "QUEUED") {
    // The request was settled meanwhile; the answer is dropped and the job closed so it is not handed out again.
    if (sub.jobId !== null) closeJob(db, sub.jobId, "stale", at);
    return done("stale");
  }
  const reason = answer.outcome === "failed" ? answer.reason : linkFailure(sub, answer, options.acceptFakeHost);
  if (answer.outcome === "failed" || reason !== null) {
    const why = reason ?? "failed";
    if (sub.jobId !== null) closeJob(db, sub.jobId, why, at);
    const settled = settleFailure(db, sub, why, at, options.effects(db));
    return done(settled.outcome, why, null, settled.requestFailed);
  }
  if (sub.jobId !== null) {
    db.update(bridgeJobs).set({ status: "DONE", resultUrl: answer.url, finishedAt: at }).where(eq(bridgeJobs.jobId, sub.jobId)).run();
    notePageError(db, null);
  }
  const shareCode = newShareCode(db, options.makeCode ?? randomShareCode);
  const learned = learnedShopKey(db, sub.requestId, answer.sourceTarget);
  db.update(linkRequests).set({ status: "ISSUED", affiliateUrl: answer.url, attempts: sql`${linkRequests.attempts} + 1`, nextAttemptAt: null, ...(learned.key === null ? {} : { productKey: learned.key }) }).where(eq(linkRequests.requestId, sub.requestId)).run();
  db.insert(shareCodes).values({ code: shareCode, requestId: sub.requestId, createdAt: at }).run();
  return { ...done("issued", null, shareCode), ...(learned.ignored ? { sourceTargetIgnored: true } : {}) };
}

/** Times in a row the browser may take one job and go silent before that counts as a failed attempt. */
export const SILENT_ANSWERS_BEFORE_FAILURE = 2;

/**
 * The browser took this job and never answered (Story 5.3 review item 2); call inside `tx`. The
 * first time the job stays open and uncounted (a browser restart is not the request's fault); the
 * second time in a row it is closed `bridge_no_answer` and counted like any failure, so a page
 * that always silences the bridge cannot hold the queue.
 */
export function recordSilentBridge(db: LedgerDb, job: LinkBridgeJob, clock: Clock, effects: (db: LedgerDb) => LinkEffects): "retry" | "failed" {
  const row = db.select({ status: bridgeJobs.status, noAnswers: bridgeJobs.noAnswers }).from(bridgeJobs).where(eq(bridgeJobs.jobId, job.jobId)).get();
  if (row?.status !== "PENDING") return "retry";
  const noAnswers = row.noAnswers + 1;
  db.update(bridgeJobs).set({ noAnswers }).where(eq(bridgeJobs.jobId, job.jobId)).run();
  if (noAnswers < SILENT_ANSWERS_BEFORE_FAILURE) return "retry";
  const at = clock.now();
  closeJob(db, job.jobId, "bridge_no_answer", at);
  countFailure(db, job.requestId, at, effects(db));
  return "failed";
}

/** An answer that closes the job; `unavailable` leaves it open and is never recorded. */
export type RecordedBridgeAnswer = Exclude<BridgeLinkResult, { outcome: "unavailable" }>;

/** Closes a claimed bridge job with the bridge's answer; call inside `tx`. */
export function recordLinkResult(db: LedgerDb, job: LinkBridgeJob, result: RecordedBridgeAnswer, clock: Clock, options: RecordOptions): LinkResultRecorded {
  if (db.select({ status: bridgeJobs.status }).from(bridgeJobs).where(eq(bridgeJobs.jobId, job.jobId)).get()?.status !== "PENDING") return { requestId: job.requestId, outcome: "stale", reason: null, shareCode: null, requestFailed: false };
  return settle(db, { requestId: job.requestId, subId1: job.subId1, subId2: job.subId2, origin: "bridge", jobId: job.jobId }, result, clock, options);
}

/** What a link creator over an HTTP API answers (Story 5.7), with the sub_ids it echoed, if any. */
export type ApiLinkAnswer =
  | { readonly outcome: "link"; readonly url: string; readonly echoedSubIds?: { readonly sub1: string | null; readonly sub2: string | null } }
  | { readonly outcome: "failed"; readonly reason: string };

/** Records the AccessTrade API's answer for a claimed request; call inside `tx` (Story 5.7). */
export function recordApiLinkResult(db: LedgerDb, request: ApiLinkRequest, result: ApiLinkAnswer, clock: Clock, options: RecordOptions): LinkResultRecorded {
  return settle(db, { requestId: request.requestId, subId1: request.subId1, subId2: request.subId2, origin: "accesstrade", jobId: null }, result, clock, options);
}
