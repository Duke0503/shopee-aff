/**
 * The product lookups of the link job's run (AD-13, AD-14, D8; Story 5.6), after its link
 * submissions: one lookup at a time through the affiliate browser, each a claim transaction, the
 * bridge call with no transaction open, and a result transaction. Before every lookup the run
 * checks that no link submission is due, so a customer's link waits for at most the one lookup in
 * the browser (the order of service link, product lookup, report page). A bridge that answers
 * nobody leaves the lookup open for a later run; one that took it and went silent twice gives it
 * up. A bridge without lookups (a test double) makes none.
 */
import type { Clock } from "@cashback/core";

import type { Ledger, LedgerDb } from "../../platform/db/ledger";
import type { Logger } from "../../platform/log/logger";
import type { BridgeLookupResult, BridgePort, LookupBridgeJob } from "../../platform/ports/bridge.port";
import { claimLookupJob, linkWorkDue, recordLookupResult, recordSilentLookup } from "./link-lookup.command";
import type { LinkEffects } from "./link-result.command";

export const MAX_LOOKUPS_PER_RUN = 5;

export interface LookupJobDeps {
  readonly ledger: Ledger;
  readonly clock: Clock;
  readonly bridge: BridgePort;
  readonly logger: Logger;
  readonly effects: (db: LedgerDb) => LinkEffects;
}

async function ask(deps: LookupJobDeps, job: LookupBridgeJob, signal: AbortSignal): Promise<BridgeLookupResult | null> {
  const lookup = deps.bridge.lookupProduct;
  if (lookup === undefined) return null;
  try {
    return await lookup.call(deps.bridge, job, signal);
  } catch {
    return signal.aborted ? null : { outcome: "failed", reason: "bridge_error" };
  }
}

/** The number of lookups recorded; stops at a due link, a silent bridge or the stop signal. */
export async function runProductLookups(deps: LookupJobDeps, signal: AbortSignal): Promise<number> {
  if (deps.bridge.lookupProduct === undefined) return 0;
  let recorded = 0;
  for (let n = 0; n < MAX_LOOKUPS_PER_RUN && !signal.aborted; n++) {
    const job = deps.ledger.tx((db) => (linkWorkDue(db, deps.clock.now()) ? null : claimLookupJob(db, deps.clock)));
    if (job === null) break;
    const answer = await ask(deps, job, signal);
    if (answer === null) break;
    const where = { requestId: job.requestId, jobId: job.jobId, bridge: deps.bridge.mode };
    if (answer.outcome === "unavailable") {
      const silent = answer.reason === "no_answer" ? deps.ledger.tx((db) => recordSilentLookup(db, job, deps.clock)) : "retry";
      deps.logger.warn({ ...where, reason: answer.reason, silent }, "linking.lookup.unavailable");
      break;
    }
    const result = deps.ledger.tx((db) => recordLookupResult(db, job, answer, deps.clock, deps.effects));
    deps.logger.info({ ...where, outcome: result.outcome, reason: result.reason }, "linking.lookup.recorded");
    recorded++;
    if (result.outcome === "held" || result.outcome === "paused") break;
  }
  return recorded;
}
