/**
 * A customer's claim of an older customer code (FR-11, FR-36, D10; Story 6.11): after a new Zalo
 * account, a known customer is registered again under a new id and may write their old code
 * (DP...) in the private chat. The claim is recorded for the admin merge command, with the reason
 * "self-claimed by code"; anyone can type a code, so it is only ever a proposal, never a merge.
 * Only an active customer can claim, only another active customer's code, and a claim is kept
 * once. Call inside `tx`; the audit entry carries the two ids only.
 */
import type { Clock } from "@cashback/core";

import type { LedgerDb } from "../../platform/db/ledger";
import type { CommandAudit } from "../../platform/ports/audit.port";
import { resolveCustomer } from "./customer.query";
import { mergeClaims } from "./schema";

/** A customer code written in a message, as people type it ("dp00012", "DP 00012"). */
export const CLAIMED_CODE = /\bDP\s?(\d{5,})\b/i;

export type MergeClaimResult = "recorded" | "known" | "own" | "not_found";

/** The code a message names, upper case, or null. */
export function claimedCodeIn(text: string): string | null {
  const digits = CLAIMED_CODE.exec(text)?.[1];
  return digits === undefined ? null : `DP${digits}`;
}

export function recordMergeClaim(db: LedgerDb, claimantKey: string, claimedCode: string, deps: { readonly clock: Clock; readonly by: CommandAudit }): MergeClaimResult {
  const claimant = resolveCustomer(db, claimantKey);
  const claimed = resolveCustomer(db, claimedCode);
  if (claimant === null || claimed === null || claimed.role !== "USER" || claimed.status !== "ACTIVE" || claimant.role !== "USER" || claimant.status !== "ACTIVE") return "not_found";
  if (claimant.customerId === claimed.customerId) return "own";
  const added = db.insert(mergeClaims).values({ claimantId: claimant.customerId, claimedId: claimed.customerId, claimedAt: deps.clock.now() }).onConflictDoNothing().run().changes === 1;
  if (!added) return "known";
  deps.by.audit.record({ actor: deps.by.actor, event: "identity.merge_claim.recorded", entityId: claimant.customerId, payload: { claimantId: claimant.customerId, claimedId: claimed.customerId } });
  return "recorded";
}
