/**
 * The claim-expiry job (AD-9, AD-13, D39): every 60 seconds (platform/jobs/job-schedules.ts), one
 * transaction marks each OPEN payout claim idle for 10 minutes ABANDONED, with an audit entry
 * each. Nothing is deleted: the claim, its snapshot and the time its QR was shown stay, so the
 * next opening of that customer can warn that a transfer may already have been made.
 */
import type { Clock } from "@cashback/core";

import type { Ledger, LedgerDb } from "../../platform/db/ledger";
import type { Actor, CommandAudit } from "../../platform/ports/audit.port";
import { expireIdleClaims } from "./payout-claim.command";

/** The actor of the claim-expiry job (AD-17). */
export const CLAIM_EXPIRY_ACTOR: Actor = { kind: "system", id: "claim-expiry" };

export interface ClaimExpiryDeps {
  readonly ledger: Ledger;
  readonly clock: Clock;
  readonly audit: (db: LedgerDb, actor: Actor) => CommandAudit;
}

/** One run: how many claims became ABANDONED. */
export function runClaimExpiry(deps: ClaimExpiryDeps): number {
  return deps.ledger.tx((db) => expireIdleClaims(db, { clock: deps.clock, by: deps.audit(db, CLAIM_EXPIRY_ACTOR) }));
}
