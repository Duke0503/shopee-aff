/**
 * The product lookups of the link job's run (AD-13, AD-14, D8; Story 5.6), after its link
 * submissions: one lookup at a time through the affiliate browser, each a claim transaction, the
 * bridge call with no transaction open, and a result transaction. Before every lookup the run
 * checks that no link submission is due, so a customer's link waits for at most the one lookup in
 * the browser (the order of service link, product lookup, report page). A bridge that answers
 * nobody leaves the lookup open for a later run; one that took it and went silent twice gives it
 * up. A bridge without lookups (a test double) makes none.
 *
 * The third party, when configured, is asked first for every claimed lookup (owner decision
 * 2026-11-02, the live order since 1819487), with no transaction open: usable facts close the
 * lookup without the browser; a failure, a timeout or an unusable answer hands it on to the bridge
 * unchanged. A request whose link names no item id (a short link) skips the third party. Its log
 * lines carry reason codes only, never the request URL, which holds the key.
 */
import type { Clock } from "@cashback/core";

import type { Ledger, LedgerDb } from "../../platform/db/ledger";
import type { Logger } from "../../platform/log/logger";
import type { BridgeLookupResult, BridgePort, LookupBridgeJob } from "../../platform/ports/bridge.port";
import type { ThirdPartyLookup } from "./addlivetag-lookup.adapter";
import { claimLookupJob, closeUnansweredLookup, linkWorkDue, lookupItemOf, recordLookupResult, recordSilentLookup, recordThirdPartyFacts } from "./link-lookup.command";
import type { LinkEffects } from "./link-result.command";

export const MAX_LOOKUPS_PER_RUN = 5;

export interface LookupJobDeps {
  readonly ledger: Ledger;
  readonly clock: Clock;
  readonly bridge: BridgePort;
  readonly logger: Logger;
  readonly effects: (db: LedgerDb) => LinkEffects;
  /** The first source of product facts (THIRD_PARTY_LOOKUP); null or absent: the bridge alone. */
  readonly thirdParty?: ThirdPartyLookup | null;
}

/** True when the third party's facts were recorded for the job (or it went stale meanwhile). */
async function askThirdParty(deps: LookupJobDeps, job: LookupBridgeJob, signal: AbortSignal): Promise<boolean> {
  const source = deps.thirdParty;
  if (source === undefined || source === null) return false;
  const where = { requestId: job.requestId, jobId: job.jobId, source: "third_party" };
  const item = deps.ledger.tx((db) => lookupItemOf(db, job.requestId));
  if (item === null) {
    deps.logger.info({ ...where, reason: "no_item_id" }, "linking.lookup.third_party_skipped");
    return false;
  }
  const answer = await source.lookup(item.itemId, signal);
  if (!answer.ok) {
    deps.logger.info({ ...where, reason: answer.reason }, "linking.lookup.third_party_missed");
    return false;
  }
  const result = deps.ledger.tx((db) => recordThirdPartyFacts(db, job, item.shopId, answer.facts, deps.clock));
  deps.logger.info({ ...where, outcome: result.outcome }, "linking.lookup.recorded");
  return true;
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
  const thirdParty = deps.thirdParty !== undefined && deps.thirdParty !== null;
  if (deps.bridge.lookupProduct === undefined && !thirdParty) return 0;
  let recorded = 0;
  for (let n = 0; n < MAX_LOOKUPS_PER_RUN && !signal.aborted; n++) {
    const job = deps.ledger.tx((db) => (linkWorkDue(db, deps.clock.now()) ? null : claimLookupJob(db, deps.clock)));
    if (job === null) break;
    if (await askThirdParty(deps, job, signal)) {
      recorded++;
      continue;
    }
    if (signal.aborted) break;
    if (deps.bridge.lookupProduct === undefined) {
      deps.ledger.tx((db) => closeUnansweredLookup(db, job, "third_party_missed", deps.clock));
      continue;
    }
    const answer = await ask(deps, job, signal);
    if (answer === null) break;
    const where = { requestId: job.requestId, jobId: job.jobId, bridge: deps.bridge.mode };
    if (answer.outcome === "unavailable") {
      const silent = answer.reason === "no_answer" ? deps.ledger.tx((db) => recordSilentLookup(db, job, deps.clock)) : "retry";
      deps.logger.warn({ ...where, reason: answer.reason, silent }, "linking.lookup.unavailable");
      break;
    }
    const result = deps.ledger.tx((db) => recordLookupResult(db, job, answer, deps.clock, deps.effects));
    deps.logger.info({ ...where, outcome: result.outcome, reason: result.reason, ...(result.page === undefined ? {} : { page: result.page }) }, "linking.lookup.recorded");
    recorded++;
    if (result.outcome === "held" || result.outcome === "paused") break;
  }
  return recorded;
}
