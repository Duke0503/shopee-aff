/**
 * The link job (AD-13, AD-14; Story 5.1): every 5 s it serves the link queue, one bridge
 * submission at a time. Each submission is a claim transaction, the bridge call with no
 * transaction open, and a result transaction. A run serves at most `MAX_LINKS_PER_RUN`, so a long
 * queue never holds a run open. A failed submission backs its request off and the run goes on to
 * the next one, so one failing request never starves the queue. When the scheduler's stop signal
 * ends a bridge call, the job stays open uncounted and the next start hands it out again. Log
 * lines carry ids only, never the affiliate URL.
 */
import type { Clock } from "@cashback/core";

import type { Ledger } from "../../platform/db/ledger";
import type { Logger } from "../../platform/log/logger";
import type { BridgeLinkResult, BridgePort } from "../../platform/ports/bridge.port";
import { guestCustomerIds } from "../identity/index";
import { claimLinkJob, recordLinkResult } from "./link-issue.command";

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
  /** True when the stop signal ended the run with a submission left open. */
  readonly interrupted: boolean;
}

export async function runLinkJob(deps: LinkJobDeps, signal: AbortSignal): Promise<LinkJobRun> {
  const options = { subIdPrefix: deps.subIdPrefix, guestIds: guestCustomerIds(deps.ledger.db) };
  const acceptFakeHost = deps.bridge.mode === "fake";
  let issued = 0;
  let failed = 0;
  for (let n = 0; n < MAX_LINKS_PER_RUN && !signal.aborted; n++) {
    const job = deps.ledger.tx((db) => claimLinkJob(db, deps.clock, options));
    if (job === null) break;
    let result: BridgeLinkResult;
    try {
      result = await deps.bridge.createLink(job, signal);
    } catch {
      // Shutdown is not the request's failure: the job stays PENDING and is resent after the restart.
      if (signal.aborted) return { issued, failed, interrupted: true };
      result = { outcome: "failed", reason: "bridge_error" };
    }
    const recorded = deps.ledger.tx((db) => recordLinkResult(db, job, result, deps.clock, { acceptFakeHost }));
    if (recorded.outcome === "issued") issued++;
    if (recorded.outcome === "failed") failed++;
    deps.logger.info({ requestId: job.requestId, jobId: job.jobId, outcome: recorded.outcome, reason: recorded.reason, bridge: deps.bridge.mode }, "linking.link.recorded");
  }
  return { issued, failed, interrupted: false };
}
