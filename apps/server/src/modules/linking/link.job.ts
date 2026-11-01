/**
 * The link job (AD-13, AD-14; Story 5.1): every 5 s it serves the link queue, one bridge
 * submission at a time. Each submission is a claim transaction, the bridge call with no
 * transaction open, and a result transaction. A run serves at most `MAX_LINKS_PER_RUN`, so a long
 * queue never holds a run open. A failed submission backs its request off and the run goes on to
 * the next one, so one failing request never starves the queue. When the scheduler's stop signal
 * ends a bridge call, or the bridge does not answer at all (no browser took the job, or it went
 * silent, Story 5.3), the job stays open uncounted, the run ends, and a later run hands it out
 * again; a job the bridge took and went silent on twice in a row counts as a failed attempt and
 * backs off like any failure, so it never stays in front of the requests behind it. Log
 * lines carry ids only, never the affiliate URL.
 */
import type { Clock } from "@cashback/core";

import type { Ledger } from "../../platform/db/ledger";
import type { Logger } from "../../platform/log/logger";
import type { BridgeLinkResult, BridgePort, LinkBridgeJob } from "../../platform/ports/bridge.port";
import { guestCustomerIds } from "../identity/index";
import { claimLinkJob, recordLinkResult, recordSilentBridge } from "./link-issue.command";

export const MAX_LINKS_PER_RUN = 20;

export interface LinkJobDeps {
  readonly ledger: Ledger;
  readonly clock: Clock;
  readonly bridge: BridgePort;
  /** `DEV` in dev, empty in production (AD-25). */
  readonly subIdPrefix: string;
  readonly logger: Logger;
}

export interface LinkJobRun {
  readonly issued: number;
  readonly failed: number;
  /** True when the stop signal or a silent bridge ended the run with a submission left open. */
  readonly interrupted: boolean;
}

type Served = "issued" | "failed" | "stale" | "stop";

/** The bridge's answer, or null when the stop signal ended the call (not the request's failure). */
async function askBridge(deps: LinkJobDeps, job: LinkBridgeJob, signal: AbortSignal): Promise<BridgeLinkResult | null> {
  try {
    return await deps.bridge.createLink(job, signal);
  } catch {
    return signal.aborted ? null : { outcome: "failed", reason: "bridge_error" };
  }
}

/** One submission: the bridge call with no transaction open, then its result in one transaction. */
async function serveOne(deps: LinkJobDeps, job: LinkBridgeJob, signal: AbortSignal, acceptFakeHost: boolean): Promise<Served> {
  const result = await askBridge(deps, job, signal);
  if (result === null) return "stop";
  const where = { requestId: job.requestId, jobId: job.jobId, bridge: deps.bridge.mode };
  if (result.outcome === "unavailable") {
    // No poller at all is not counted; a bridge that took the job and went silent is, after a second time.
    const silent = result.reason === "no_answer" ? deps.ledger.tx((db) => recordSilentBridge(db, job, deps.clock)) : "retry";
    deps.logger.warn({ ...where, reason: result.reason, silent }, "linking.bridge.unavailable");
    return silent === "failed" ? "failed" : "stop";
  }
  const recorded = deps.ledger.tx((db) => recordLinkResult(db, job, result, deps.clock, { acceptFakeHost }));
  deps.logger.info({ ...where, outcome: recorded.outcome, reason: recorded.reason }, "linking.link.recorded");
  return recorded.outcome;
}

export async function runLinkJob(deps: LinkJobDeps, signal: AbortSignal): Promise<LinkJobRun> {
  const options = { subIdPrefix: deps.subIdPrefix, guestIds: guestCustomerIds(deps.ledger.db) };
  const acceptFakeHost = deps.bridge.mode === "fake";
  let issued = 0;
  let failed = 0;
  for (let n = 0; n < MAX_LINKS_PER_RUN && !signal.aborted; n++) {
    const job = deps.ledger.tx((db) => claimLinkJob(db, deps.clock, options));
    if (job === null) break;
    const served = await serveOne(deps, job, signal, acceptFakeHost);
    if (served === "stop") return { issued, failed, interrupted: true };
    if (served === "issued") issued++;
    if (served === "failed") failed++;
  }
  return { issued, failed, interrupted: false };
}
