/**
 * Staff resolve a review case (AD-7, AD-8, AD-17, D38, FR-14, status-flows.md §6; Story 3.9), in
 * one transaction with its history, audit and outbox rows. Apply writes exactly the plan
 * review-plan.query.ts previews, through reconciliation's own write path (`applyPlanned`), so
 * every effect `transition` gives (status, split, awards, alerts, clawbacks, review cases) is
 * carried out the one way. Dismiss closes the case with a reason and changes nothing else. Staff
 * can also report a wrong rejection (D38) of an order the report has shown, which opens the case
 * apply then judges against the latest observation. No command takes an amount.
 */
import { eq } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { findOrder, latestObservation } from "./order-ledger.repository";
import { applyPlanned, type ApplyDeps } from "./report-apply.command";
import { openOrRefreshCase, type CaseWrite } from "./review-case.command";
import { openCaseOf, planReviewApply, previewOf, requireStaff, ReviewCaseError, type ReviewApplyInput } from "./review-plan.query";
import { reviewCases } from "./schema";

export interface ReviewOutcome {
  readonly caseId: number;
  readonly orderId: string | null;
  readonly resolution: "APPLIED" | "DISMISSED";
}

type Resolution = { readonly caseId: number; readonly orderId: string | null; readonly resolution: "APPLIED" | "DISMISSED"; readonly reason: string; readonly reviewReason: string; readonly network: string };

function resolveCase(db: LedgerDb, r: Resolution, deps: ApplyDeps): ReviewOutcome {
  const at = deps.clock.now();
  db.update(reviewCases)
    .set({ status: "RESOLVED", resolution: r.resolution, resolvedAt: at, resolvedBy: deps.by.actor.id, resolutionReason: r.reason.trim(), orderId: r.orderId })
    .where(eq(reviewCases.caseId, r.caseId))
    .run();
  deps.by.audit.record({
    actor: deps.by.actor,
    event: `orders.review_case.${r.resolution === "APPLIED" ? "applied" : "dismissed"}`,
    entityId: String(r.caseId),
    payload: { caseId: r.caseId, network: r.network, reason: r.reviewReason, orderId: r.orderId },
    reason: r.reason.trim(),
  });
  return { caseId: r.caseId, orderId: r.orderId, resolution: r.resolution };
}

/** Applies the case with a reason; call inside `tx`. Refuses with a `ReviewCaseError` and writes nothing when the rules do not allow it. */
export function applyReviewCase(db: LedgerDb, input: ReviewApplyInput, deps: ApplyDeps): ReviewOutcome {
  const plan = planReviewApply(db, input, { ...deps, actor: deps.by.actor });
  const c = plan.reviewCase;
  // The same refusal the preview gives: a plan that records no order is never written.
  previewOf(db, plan);
  const report = applyPlanned(db, { row: plan.row, stored: plan.stored, result: plan.result, attribution: plan.attribution, review: { caseId: c.caseId, reason: input.reason.trim() } }, deps);
  if (report.outcome === "unrecorded") throw new ReviewCaseError("review_not_applicable", `review case ${c.caseId} recorded no order`);
  return resolveCase(db, { caseId: c.caseId, orderId: report.orderId, resolution: "APPLIED", reason: input.reason, reviewReason: c.reason, network: c.network }, deps);
}

/** Dismisses the case with a reason; the order and its money are unchanged. Call inside `tx`. */
export function dismissReviewCase(db: LedgerDb, input: { readonly caseId: number; readonly reason: string }, deps: ApplyDeps): ReviewOutcome {
  requireStaff(deps.by.actor, input.reason);
  const c = openCaseOf(db, input.caseId);
  return resolveCase(db, { caseId: c.caseId, orderId: c.orderId, resolution: "DISMISSED", reason: input.reason, reviewReason: c.reason, network: c.network }, deps);
}

/**
 * Staff report that a REJECTED order was rejected wrongly (D38): one `wrong_rejection` case with its
 * latest observation. An order no report has shown is refused here, since apply could never judge it.
 */
export function reportWrongRejection(db: LedgerDb, input: { readonly orderId: string; readonly reason: string }, deps: ApplyDeps): CaseWrite {
  requireStaff(deps.by.actor, input.reason);
  const stored = findOrder(db, input.orderId);
  if (stored === null || stored.status !== "REJECTED" || stored.network === null) throw new ReviewCaseError("review_not_applicable", `order ${input.orderId} is not a rejected order`);
  const latest = latestObservation(db, stored.orderId);
  if (latest === null) throw new ReviewCaseError("no_observation", `order ${input.orderId} has no report row to judge a wrong rejection by (D38)`);
  const evidence = {
    network: stored.network,
    subject: stored.orderId,
    orderId: stored.orderId,
    reason: "wrong_rejection" as const,
    candidates: stored.customerId === null ? [] : [stored.customerId],
    observation: latest.observation,
    fingerprint: latest.fingerprint,
  };
  return openOrRefreshCase(db, evidence, { by: deps.by, at: deps.clock.now() });
}
