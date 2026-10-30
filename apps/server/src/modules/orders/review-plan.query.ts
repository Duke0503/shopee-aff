/**
 * What applying a review case would do (AD-7, AD-8, D38, FR-14, Story 3.9), read without writing:
 * the preview staff see and the plan the apply command writes, so the two cannot differ.
 *
 * - A case with no recorded order (no customer found, an unresolved sub_id1, an owner
 *   disagreement) records the order for one of the rule's candidates, through attribution and
 *   `transition`: AWAITING_APPROVAL, or the state the report row gives.
 * - A case on a REJECTED order is a wrong rejection (D38): back to AWAITING_APPROVAL only when the
 *   latest observation has no cancel signal. A case on a FROZEN order restores the state it was
 *   frozen from, or rejects it.
 *
 * The plan reads its context with reconciliation's own `contextFor`, and apply writes the planned
 * result through reconciliation's write path (`applyPlanned`) without recomputing it. Apply never
 * changes a PAID order (D4), never attributes a guest order to a customer (D5), never chooses a
 * customer the rules did not produce and never takes an amount (INV-1, INV-2).
 */
import { STAFF_ROLES, type Clock, type Instant, type OrderStatus } from "@cashback/core";
import { eq } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { hasStaffRole, type Actor } from "../../platform/ports/audit.port";
import { sourced, type SourcedRow } from "../linking/index";
import { applyResult } from "./domain/applied-order";
import type { Attribution } from "./domain/attribution";
import { transition, TransitionError, type ReviewContext, type TransitionResult } from "./domain/transition";
import { ledgerDirectory } from "./ledger-directory.query";
import { findOrder, frozenFrom, latestObservation, transitionOrderOf, type StoredOrder } from "./order-ledger.repository";
import { contextFor, type ContextDeps } from "./report-apply.command";
import { reviewCases } from "./schema";

export type ReviewCaseErrorCode =
  | "staff_only"
  | "reason_missing"
  | "case_not_found"
  | "case_resolved"
  | "order_paid"
  | "guest_order"
  | "candidate_required"
  | "not_a_candidate"
  | "cancel_signal_seen"
  | "no_observation"
  | "evidence_changed"
  | "review_not_applicable";

export class ReviewCaseError extends Error {
  constructor(
    readonly code: ReviewCaseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ReviewCaseError";
  }
}

export interface ReviewApplyInput {
  readonly caseId: number;
  readonly reason: string;
  /** One of the case's candidates; needed only when a case without an order has more than one. */
  readonly customerId?: string;
  /** For a FROZEN order: restore the state it was frozen from (the default) or reject it. */
  readonly outcome?: "restore" | "reject";
}

export type ReviewCaseRow = typeof reviewCases.$inferSelect;

export interface ReviewPlan {
  readonly reviewCase: ReviewCaseRow;
  /** The case's row for an order not recorded yet; the order's latest stored row otherwise. */
  readonly row: SourcedRow;
  /** The recorded order; null when the plan records the row for the chosen candidate. */
  readonly stored: StoredOrder | null;
  readonly attribution?: Extract<Attribution, { kind: "customer" }>;
  readonly result: TransitionResult;
}

export interface ReviewPreview {
  readonly caseId: number;
  readonly orderId: string;
  readonly customerId: string | null;
  readonly from: OrderStatus | null;
  readonly to: OrderStatus;
  /** The cashback the order would carry; null while it has none. */
  readonly cashback: number | null;
}

/** What planning or previewing a case reads: the acting staff member and read-only context, no writer. */
export interface ReviewReadDeps extends ContextDeps {
  readonly clock: Clock;
  readonly actor: Actor;
}

const refuse = (code: ReviewCaseErrorCode, message: string): never => {
  throw new ReviewCaseError(code, message);
};

/**
 * Review commands are for staff with the admin or employee role (FR-24, Story 4.2), checked here
 * as well as on the staff route, so no caller reaches them with another actor or role.
 */
export function requireStaff(actor: Actor, reason: string): void {
  if (!hasStaffRole(actor, STAFF_ROLES)) refuse("staff_only", "only staff (admin or employee) resolve a review case");
  if (reason.trim() === "") refuse("reason_missing", "a review case is resolved with a reason");
}

export function openCaseOf(db: LedgerDb, caseId: number): ReviewCaseRow {
  const found = db.select().from(reviewCases).where(eq(reviewCases.caseId, caseId)).get();
  if (found === undefined) return refuse("case_not_found", `no review case ${caseId}`);
  if (found.status !== "OPEN") refuse("case_resolved", `review case ${caseId} is already resolved`);
  return found;
}

const candidatesOf = (c: ReviewCaseRow): string[] => JSON.parse(c.candidates) as string[];

/** A stored row (a case's or an observation's JSON, as reconciliation wrote it) as the row it was; null when it holds none. */
function storedRow(json: string, network: SourcedRow["network"]): SourcedRow | null {
  const o = JSON.parse(json) as Partial<SourcedRow>;
  if (typeof o.orderId !== "string" || !Array.isArray(o.items) || !Array.isArray(o.subIds)) return null;
  const { orderId, rawOrderStatus = null, orderStatus = null, items, subIds, problems = [] } = o;
  return sourced({ network: o.network ?? network, orderId, rawOrderStatus, orderStatus, items, subIds, problems }, (o.purchasedAt ?? null) as Instant | null);
}

/** The report row the case carries; its fingerprint must still match. */
function caseRow(c: ReviewCaseRow): SourcedRow {
  const row = storedRow(c.observation, c.network) ?? refuse("no_observation", `review case ${c.caseId} carries no report row`);
  if (c.fingerprint !== null && row.fingerprint !== c.fingerprint) refuse("evidence_changed", `review case ${c.caseId} no longer matches its report row`);
  return row;
}

/** A row whose order is not recorded: staff choose one of the rule's candidates. */
function planAttribution(db: LedgerDb, c: ReviewCaseRow, input: ReviewApplyInput, deps: ReviewReadDeps): ReviewPlan {
  const row = caseRow(c);
  if (row.orderId === "") refuse("review_not_applicable", "a row without an order id cannot record an order");
  const candidates = candidatesOf(c);
  const target = input.customerId ?? (candidates.length === 1 ? candidates[0] : undefined);
  if (target === undefined) return refuse(candidates.length === 0 ? "not_a_candidate" : "candidate_required", `review case ${c.caseId} needs one of its candidates`);
  const directory = ledgerDirectory(db);
  const subId2 = (row.subIds[1] ?? "").trim();
  const owner = subId2 === "" ? null : directory.requestOwner(subId2);
  const byRequest = owner === null ? null : directory.resolveCustomer(owner);
  const resolved = directory.resolveCustomer(target);
  const guestRow = byRequest?.guest === true || candidates.some((id) => directory.resolveCustomer(id)?.guest === true);
  if (guestRow && resolved?.guest !== true) refuse("guest_order", "a guest order is never attributed to a customer (D5)");
  if (!candidates.includes(target) || resolved === null) return refuse("not_a_candidate", `${target} is not a candidate of review case ${c.caseId}`);
  const credited = byRequest?.customerId === resolved.customerId ? subId2 : null;
  const attribution = {
    kind: "customer",
    customerId: resolved.customerId,
    source: credited === null ? "sub_id1" : "sub_id2",
    guest: resolved.guest,
    requestId: credited,
    unmatchedRequest: credited === null && subId2 !== "" ? subId2 : null,
  } as const;
  const result = transition(null, { kind: "report", row }, contextFor(db, row, null, directory, deps, deps.clock.now(), attribution));
  return { reviewCase: c, row, stored: null, attribution, result };
}

/** The order's latest stored row (D38); an imported FROZEN order never seen in a report is judged as it stands. */
function latestRow(db: LedgerDb, stored: StoredOrder, network: SourcedRow["network"], required: boolean): SourcedRow {
  const latest = latestObservation(db, stored.orderId);
  const row = latest === null ? null : storedRow(latest.observation, network);
  if (row !== null) return row;
  if (required) refuse("no_observation", `order ${stored.orderId} has no report row to judge a wrong rejection by (D38)`);
  return sourced({ network, orderId: stored.orderId, rawOrderStatus: null, orderStatus: null, items: [], subIds: [], problems: [] }, null);
}

function reviewFor(db: LedgerDb, stored: StoredOrder, input: ReviewApplyInput): ReviewContext {
  if (stored.status === "REJECTED") return { kind: "wrong_rejection", reason: input.reason };
  if (stored.status !== "FROZEN") return refuse("review_not_applicable", `a ${stored.status} order has nothing to apply; dismiss the case instead`);
  const from = frozenFrom(db, stored.orderId);
  const previous = from === "APPROVED" || from === "AWAITING_APPROVAL" ? from : stored.approvedAt !== null && stored.cashback !== null ? "APPROVED" : "AWAITING_APPROVAL";
  return { kind: "resolve_frozen", reason: input.reason, previous, outcome: input.outcome ?? "restore" };
}

/** A case on a recorded order: the order's owner stays, and `transition` decides with the review context. */
function planReview(db: LedgerDb, c: ReviewCaseRow, stored: StoredOrder, input: ReviewApplyInput, deps: ReviewReadDeps): ReviewPlan {
  if (stored.status === "PAID" || stored.paidAt !== null) refuse("order_paid", `order ${stored.orderId} is paid and never changes (D4)`);
  const order = transitionOrderOf(db, stored);
  if (input.customerId !== undefined && order.guest) refuse("guest_order", "a guest order is never attributed to a customer (D5)");
  if (input.customerId !== undefined && input.customerId !== stored.customerId) refuse("not_a_candidate", "apply never moves an order to another customer");
  if (stored.network === null) return refuse("review_not_applicable", `order ${stored.orderId} has no network yet`);
  const review = reviewFor(db, stored, input);
  const row = latestRow(db, stored, stored.network, review.kind === "wrong_rejection");
  const context = { ...contextFor(db, row, stored, ledgerDirectory(db), deps, deps.clock.now()), review };
  try {
    const result = transition(order, { kind: "report", row }, context);
    if (result.effects.some((e) => e.kind === "review_refused")) refuse("cancel_signal_seen", `the latest report row of order ${stored.orderId} shows a cancel signal (D38)`);
    return { reviewCase: c, row, stored, result };
  } catch (error) {
    if (error instanceof TransitionError && error.code === "reason_missing") refuse("reason_missing", error.message);
    throw error;
  }
}

/** The plan of applying the case; writes nothing. */
export function planReviewApply(db: LedgerDb, input: ReviewApplyInput, deps: ReviewReadDeps): ReviewPlan {
  requireStaff(deps.actor, input.reason);
  const c = openCaseOf(db, input.caseId);
  const stored = findOrder(db, c.orderId ?? c.subject);
  return stored === null ? planAttribution(db, c, input, deps) : planReview(db, c, stored, input, deps);
}

/** The order state a plan leaves; refuses a plan that would record no order. */
export function previewOf(db: LedgerDb, plan: ReviewPlan): ReviewPreview {
  const before = plan.stored === null ? null : transitionOrderOf(db, plan.stored);
  const after = applyResult(before, plan.result);
  if (after.order === null) return refuse("review_not_applicable", `review case ${plan.reviewCase.caseId} would record no order`);
  const customerId = plan.stored === null ? (plan.attribution?.customerId ?? null) : plan.stored.customerId;
  return { caseId: plan.reviewCase.caseId, orderId: plan.row.orderId, customerId, from: before?.status ?? null, to: after.order.status, cashback: after.order.cashback };
}

/** The resulting order state of applying the case, without writing anything (Story 3.9 AC6). */
/** Reads only: call with a plain handle, outside any transaction. */
export function previewReviewApply(db: LedgerDb, input: ReviewApplyInput, deps: ReviewReadDeps): ReviewPreview {
  return previewOf(db, planReviewApply(db, input, deps));
}
