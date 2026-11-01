/**
 * The link job (AD-13, AD-14, AD-22; Stories 5.1, 5.4, 5.5, 5.7): every 5 s it serves the link
 * queue, one submission at a time. Each submission is a claim transaction, the call with no
 * transaction open, and a result transaction. A Shopee submission goes to the browser bridge,
 * which answers a short link together with its target resolved in the real browser (Story 5.4;
 * the server never calls Shopee, D8); a TikTok Shop submission goes to the AccessTrade API. A run
 * serves at most `MAX_LINKS_PER_RUN`, so a long queue never holds a run open. A failed submission
 * backs its request off and the run goes on to the next one, so one failing request never starves
 * the queue; after a captcha, a page error or a lost login holds or pauses the Shopee queue, the
 * run goes on with the AccessTrade requests only (Story 5.5 review item 5). When the scheduler's stop signal ends a call, or the bridge
 * does not answer at all (no browser took the job, or it went silent, Story 5.3), the job stays
 * open uncounted, the run ends, and a later run hands it out again; a job the bridge took and went
 * silent on twice in a row counts as a failed attempt. Log lines carry ids, and a dropped link
 * only without its query (Story 5.4 AC1), never the affiliate URL itself.
 */
import type { Clock } from "@cashback/core";

import type { Ledger, LedgerDb } from "../../platform/db/ledger";
import type { Logger } from "../../platform/log/logger";
import type { BridgeLinkResult, BridgePort, LinkBridgeJob } from "../../platform/ports/bridge.port";
import { guestCustomerIds } from "../identity/index";
import type { LinkCreator } from "./accesstrade-link.adapter";
import { linkWithoutQuery } from "./domain/link-check";
import { RELOGIN_RUNBOOK } from "./domain/link-failure";
import { claimLinkWork, type ApiLinkRequest } from "./link-issue.command";
import { recordApiLinkResult, recordLinkResult, recordSilentBridge, type ApiLinkAnswer, type LinkEffects, type LinkResultRecorded, type RecordedBridgeAnswer } from "./link-result.command";

export const MAX_LINKS_PER_RUN = 20;

export interface LinkJobDeps {
  readonly ledger: Ledger;
  readonly clock: Clock;
  readonly bridge: BridgePort;
  /** `DEV` in dev, empty in production (AD-25). */
  readonly subIdPrefix: string;
  readonly logger: Logger;
  /** The outbox and alerts bound to each result transaction (Story 5.5). */
  readonly effects: (db: LedgerDb) => LinkEffects;
  /** The AccessTrade link creator (Story 5.7); without it a TikTok Shop request fails `accesstrade_unconfigured`. */
  readonly accessTrade?: LinkCreator | null;
}

export interface LinkJobRun {
  readonly issued: number;
  readonly failed: number;
  /** True when the stop signal or a silent bridge ended the run with a submission left open. */
  readonly interrupted: boolean;
}

type Served = LinkResultRecorded["outcome"] | "stop";

/** The bridge's answer, or null when the stop signal ended the call (not the request's failure). */
async function askBridge(deps: LinkJobDeps, job: LinkBridgeJob, signal: AbortSignal): Promise<BridgeLinkResult | null> {
  try {
    return await deps.bridge.createLink(job, signal);
  } catch {
    return signal.aborted ? null : { outcome: "failed", reason: "bridge_error" };
  }
}

function logRecorded(deps: LinkJobDeps, where: Record<string, unknown>, recorded: LinkResultRecorded, link: string | null): void {
  const line = { ...where, outcome: recorded.outcome, reason: recorded.reason, requestFailed: recorded.requestFailed };
  if (recorded.outcome === "paused") deps.logger.error({ ...line, runbook: RELOGIN_RUNBOOK }, "linking.link_queue.paused");
  else if (recorded.reason?.startsWith("link_") === true) deps.logger.warn({ ...line, link: link === null ? null : linkWithoutQuery(link) }, "linking.link.dropped");
  else deps.logger.info(line, "linking.link.recorded");
  if (recorded.sourceTargetIgnored === true) deps.logger.warn({ requestId: recorded.requestId }, "linking.link.source_target_ignored");
}

/** One bridge submission: the bridge call with no transaction open, then its result in one transaction. */
async function serveBridge(deps: LinkJobDeps, job: LinkBridgeJob, signal: AbortSignal, acceptFakeHost: boolean): Promise<Served> {
  const answer = await askBridge(deps, job, signal);
  if (answer === null) return "stop";
  const where = { requestId: job.requestId, jobId: job.jobId, bridge: deps.bridge.mode };
  if (answer.outcome === "unavailable") {
    // No poller at all is not counted; a bridge that took the job and went silent is, after a second time.
    const silent = answer.reason === "no_answer" ? deps.ledger.tx((db) => recordSilentBridge(db, job, deps.clock, deps.effects)) : "retry";
    deps.logger.warn({ ...where, reason: answer.reason, silent }, "linking.bridge.unavailable");
    return silent === "failed" ? "failed" : "stop";
  }
  const result: RecordedBridgeAnswer = answer;
  const recorded = deps.ledger.tx((db) => recordLinkResult(db, job, result, deps.clock, { acceptFakeHost, effects: deps.effects }));
  logRecorded(deps, where, recorded, result.outcome === "link" ? result.url : null);
  return recorded.outcome;
}

/** One AccessTrade submission: the API call with no transaction open, then its result (Story 5.7). */
async function serveApi(deps: LinkJobDeps, request: ApiLinkRequest, signal: AbortSignal): Promise<Served> {
  const creator = deps.accessTrade ?? null;
  let answer: ApiLinkAnswer;
  try {
    answer = creator === null ? { outcome: "failed", reason: "accesstrade_unconfigured" } : await creator.createLink(request, signal);
  } catch {
    if (signal.aborted) return "stop";
    answer = { outcome: "failed", reason: "accesstrade_error" };
  }
  const recorded = deps.ledger.tx((db) => recordApiLinkResult(db, request, answer, deps.clock, { acceptFakeHost: creator?.mode === "fake", effects: deps.effects }));
  logRecorded(deps, { requestId: request.requestId, network: request.network }, recorded, answer.outcome === "link" ? answer.url : null);
  return recorded.outcome;
}

export async function runLinkJob(deps: LinkJobDeps, signal: AbortSignal): Promise<LinkJobRun> {
  const options = { subIdPrefix: deps.subIdPrefix, guestIds: guestCustomerIds(deps.ledger.db) };
  const acceptFakeHost = deps.bridge.mode === "fake";
  let issued = 0;
  let failed = 0;
  for (let n = 0; n < MAX_LINKS_PER_RUN && !signal.aborted; n++) {
    const work = deps.ledger.tx((db) => claimLinkWork(db, deps.clock, options));
    if (work === null) break;
    const served = work.kind === "bridge" ? await serveBridge(deps, work.job, signal, acceptFakeHost) : await serveApi(deps, work.request, signal);
    if (served === "stop") return { issued, failed, interrupted: true };
    if (served === "issued") issued++;
    if (served === "failed") failed++;
    // A held or paused Shopee queue is skipped by the next claim; AccessTrade work behind it goes on.
  }
  return { issued, failed, interrupted: false };
}
