/**
 * The order state machine (AD-7, FR-12, FR-14, status-flows.md §1): the only place an order
 * status changes. Reconciliation, review apply, payout confirm and payout void all call it, so
 * they can never disagree on a transition. It is pure: the caller loads the order and the
 * context, then carries out the effects in one transaction.
 *
 * - A report row is read through `reportSignal` (cancel precedence D31; Shopee UNPAID arrives
 *   as AWAITING and is never a cancel, D38).
 * - A cancel before approval rejects; after approval and before payout it reverses (D30) unless
 *   the order is under an OPEN payout claim, when the row is stored and applied after the claim
 *   ends (D39); after payout the order stays PAID and the effect is a clawback (D4, D30, D35).
 * - An unknown status or a missing order id freezes (D31); a lower approved commission freezes
 *   an approved unpaid order and claws back the difference on a paid one (D55). FROZEN suspends
 *   the order's awards; only REJECTED or REVERSED voids them.
 * - FROZEN and REJECTED leave only through a review case (D38); a payout void returns the state
 *   the latest report row gives (D41).
 *
 * Every step it takes is checked against the registry's transitions, which a test keeps equal
 * to status-flows.md; any other step throws. A guest (HOUSE) order never carries cashback (D5).
 */
import { canTransition, STATUS_REGISTRY, type OrderStatus } from "@cashback/core";
import { clawbackAmount, isWithheld, partialClawbackAmount, splitCommission, sumDong, type AffiliateNetwork, type Split } from "@cashback/money";

import type { Attribution, ReviewReason } from "./attribution";
import { reportSignal, type CancelReason, type FreezeReason, type ReportObservation, type ReportSignal } from "./report-signal";

export interface TransitionOrder {
  readonly status: OrderStatus;
  readonly paidAt: string | null;
  readonly approvedCommission: number | null;
  readonly cashback: number | null;
  /** The owner is the guest account (HOUSE, D5). */
  readonly guest: boolean;
}

export type Observation =
  | { readonly kind: "report"; readonly row: ReportObservation }
  | { readonly kind: "payout_confirmed" }
  /** `latest` is the order's latest report row, or null when it was never observed (imported). */
  | { readonly kind: "payout_voided"; readonly latest: ReportObservation | null };

export type ReviewContext =
  /** Staff apply a review case for a wrong rejection (D38). */
  | { readonly kind: "wrong_rejection"; readonly reason: string }
  /** Staff resolve a frozen order: back to the state it was frozen from, or rejected. */
  | { readonly kind: "resolve_frozen"; readonly reason: string; readonly previous: "AWAITING_APPROVAL" | "APPROVED"; readonly outcome: "restore" | "reject" };

export interface TransitionContext {
  readonly network: AffiliateNetwork;
  /** The order's settlement period is withheld (D54). */
  readonly withheld: boolean;
  /** The order is covered by an OPEN payout claim (D39). */
  readonly coveredByOpenClaim?: boolean;
  /** Campaign bonus already paid on the order (D35). */
  readonly paidBonus?: number;
  /** What earlier clawback originals on the order already took, positive. */
  readonly alreadyClawedBack?: number;
  /** Set only when staff apply a review case. */
  readonly review?: ReviewContext;
  /** Set only for the first report row of an order not yet recorded. */
  readonly attribution?: Attribution;
}

export type ReviewCaseReason = FreezeReason | ReviewReason | "cancel_after_approval" | "cancel_after_payout" | "commission_drop" | "commission_drop_after_payout";
export type AwardMove = "CONFIRMED" | "PAID" | "VOID" | "SUSPENDED" | "RESUMED";

export type Effect =
  | { readonly kind: "create_order"; readonly customerId: string; readonly guest: boolean }
  | { readonly kind: "store_observation"; readonly applied: boolean; readonly reason?: "open_payout_claim" }
  /** The split at approval (AD-5): stored with its inputs and never recomputed. */
  | { readonly kind: "store_cashback"; readonly approvedCommission: number; readonly cashback: number; readonly fee: number; readonly tax: number; readonly withheld: boolean }
  | { readonly kind: "record_rejection"; readonly reason: CancelReason }
  | { readonly kind: "open_review_case"; readonly reason: ReviewCaseReason }
  | { readonly kind: "alert"; readonly alert: "order_reversed" }
  | { readonly kind: "clawback"; readonly amount: number; readonly partial: boolean }
  | { readonly kind: "awards"; readonly to: AwardMove }
  | { readonly kind: "set_paid_at" }
  | { readonly kind: "clear_paid_at" }
  | { readonly kind: "close_clawback" }
  | { readonly kind: "review_refused"; readonly reason: "cancel_signal_seen" };

export type Step = readonly [from: OrderStatus | null, to: OrderStatus];

export interface TransitionResult {
  /** The order's state after the observation; null only when no order is recorded (unattributed row). */
  readonly next: OrderStatus | null;
  /** Each status change taken, in order; empty when the state is unchanged. */
  readonly steps: readonly Step[];
  readonly effects: readonly Effect[];
}

export type TransitionErrorCode = "transition_not_allowed" | "already_paid" | "not_payable" | "not_paid" | "review_not_applicable" | "attribution_missing" | "reason_missing";

export class TransitionError extends Error {
  constructor(
    readonly code: TransitionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TransitionError";
  }
}

interface Out {
  steps: Step[];
  effects: Effect[];
}

function move(out: Out, from: OrderStatus | null, to: OrderStatus): OrderStatus {
  const allowed = from === null ? STATUS_REGISTRY.order.initial.includes(to) : from === to || canTransition("order", from, to);
  if (!allowed) throw new TransitionError("transition_not_allowed", `${from ?? "none"} -> ${to} is not in status-flows.md`);
  if (from !== to) out.steps.push([from, to]);
  return to;
}

/** The payable commission of a row: the sum of its live items' parts (R3). */
function commissionOf(row: ReportObservation, signal: ReportSignal): number {
  if (signal.kind !== "APPROVED" && signal.kind !== "AWAITING") return 0;
  return sumDong(signal.liveItems.flatMap((i) => row.items[i]?.commissionParts ?? []), "commission part");
}

/** What a row says the order earns while it stays awaiting or approved (R3, R4); null after a cancel or freeze signal. */
export function rowCommission(row: ReportObservation): number | null {
  const signal = reportSignal(row);
  return signal.kind === "APPROVED" || signal.kind === "AWAITING" ? commissionOf(row, signal) : null;
}

const splitFor = (commission: number, order: TransitionOrder, ctx: TransitionContext): Split =>
  splitCommission({ approvedCommission: commission, network: ctx.network, withheld: ctx.withheld, guest: order.guest });

const cashbackFor = (commission: number, order: TransitionOrder, ctx: TransitionContext): number => splitFor(commission, order, ctx).cashback;

function storeCashback(commission: number, order: TransitionOrder, ctx: TransitionContext): Effect {
  const split = splitFor(commission, order, ctx);
  return { kind: "store_cashback", approvedCommission: commission, cashback: split.cashback, fee: split.fee, tax: split.tax, withheld: isWithheld(ctx.network, ctx.withheld) };
}

function freeze(out: Out, order: TransitionOrder, reason: ReviewCaseReason): OrderStatus {
  const next = move(out, order.status, "FROZEN");
  out.effects.push({ kind: "open_review_case", reason }, { kind: "awards", to: "SUSPENDED" });
  return next;
}

function fromAwaiting(out: Out, order: TransitionOrder, row: ReportObservation, signal: ReportSignal, ctx: TransitionContext): OrderStatus {
  switch (signal.kind) {
    case "FREEZE":
      return freeze(out, order, signal.reason);
    case "CANCEL":
      out.effects.push({ kind: "record_rejection", reason: signal.reason }, { kind: "awards", to: "VOID" });
      return move(out, order.status, "REJECTED");
    case "AWAITING":
      return order.status;
    case "APPROVED": {
      const commission = commissionOf(row, signal);
      out.effects.push(storeCashback(commission, order, ctx), { kind: "awards", to: "CONFIRMED" });
      return move(out, order.status, "APPROVED");
    }
  }
}

const dropped = (order: TransitionOrder, commission: number): boolean => order.approvedCommission !== null && commission > 0 && commission < order.approvedCommission;

function fromApproved(out: Out, order: TransitionOrder, row: ReportObservation, signal: ReportSignal): OrderStatus {
  if (signal.kind === "FREEZE") return freeze(out, order, signal.reason);
  if (signal.kind === "CANCEL") {
    out.effects.push({ kind: "open_review_case", reason: "cancel_after_approval" }, { kind: "alert", alert: "order_reversed" }, { kind: "awards", to: "VOID" });
    return move(out, order.status, "REVERSED");
  }
  if (signal.kind === "APPROVED" && dropped(order, commissionOf(row, signal))) return freeze(out, order, "commission_drop");
  return order.status;
}

/** A paid order never changes (D4): a cancel or a commission drop becomes a clawback, once. */
function fromPaid(out: Out, order: TransitionOrder, row: ReportObservation, signal: ReportSignal, ctx: TransitionContext): OrderStatus {
  const already = ctx.alreadyClawedBack ?? 0;
  const stored = order.guest ? 0 : (order.cashback ?? 0);
  if (signal.kind === "FREEZE") {
    out.effects.push({ kind: "open_review_case", reason: signal.reason });
  } else if (signal.kind === "CANCEL") {
    const amount = clawbackAmount({ storedCashback: stored, paidBonus: order.guest ? 0 : (ctx.paidBonus ?? 0), alreadyClawedBack: already });
    if (amount > 0) out.effects.push({ kind: "clawback", amount, partial: false }, { kind: "open_review_case", reason: "cancel_after_payout" });
  } else if (signal.kind === "APPROVED") {
    const commission = commissionOf(row, signal);
    if (dropped(order, commission)) {
      const amount = partialClawbackAmount({ storedCashback: stored, newCashback: cashbackFor(commission, order, ctx), alreadyClawedBack: already });
      if (amount > 0) out.effects.push({ kind: "clawback", amount, partial: true }, { kind: "open_review_case", reason: "commission_drop_after_payout" });
    }
  }
  return order.status;
}

function requireReason(reason: string): void {
  if (reason.trim() === "") throw new TransitionError("reason_missing", "a review case is resolved with a reason");
}

function resolveFrozen(out: Out, order: TransitionOrder, row: ReportObservation, signal: ReportSignal, review: Extract<ReviewContext, { kind: "resolve_frozen" }>, ctx: TransitionContext): OrderStatus {
  if (review.outcome === "reject" || signal.kind === "CANCEL") {
    out.effects.push({ kind: "record_rejection", reason: signal.kind === "CANCEL" ? signal.reason : "order_cancelled" }, { kind: "awards", to: "VOID" });
    return move(out, order.status, "REJECTED");
  }
  const commission = commissionOf(row, signal);
  if (review.previous === "APPROVED" && signal.kind === "APPROVED" && commission > 0 && commission !== order.approvedCommission) {
    out.effects.push(storeCashback(commission, order, ctx));
  }
  out.effects.push({ kind: "awards", to: "RESUMED" });
  return move(out, order.status, review.previous);
}

function applyReview(out: Out, order: TransitionOrder, row: ReportObservation, signal: ReportSignal, ctx: TransitionContext): OrderStatus {
  const review = ctx.review;
  if (review === undefined) throw new TransitionError("review_not_applicable", "no review case");
  requireReason(review.reason);
  if (order.status === "REJECTED" && review.kind === "wrong_rejection") {
    if (signal.kind === "CANCEL") {
      out.effects.push({ kind: "review_refused", reason: "cancel_signal_seen" });
      return order.status;
    }
    return move(out, order.status, "AWAITING_APPROVAL");
  }
  if (order.status === "FROZEN" && review.kind === "resolve_frozen") return resolveFrozen(out, order, row, signal, review, ctx);
  throw new TransitionError("review_not_applicable", `a ${review.kind} review does not apply to a ${order.status} order`);
}

function onReport(out: Out, order: TransitionOrder, row: ReportObservation, ctx: TransitionContext): OrderStatus {
  const signal = reportSignal(row);
  if (ctx.review !== undefined) {
    out.effects.push({ kind: "store_observation", applied: true });
    return applyReview(out, order, row, signal, ctx);
  }
  if (order.status === "APPROVED" && ctx.coveredByOpenClaim === true && signal.kind !== "AWAITING") {
    // Only a change is held back: a row that changes nothing is simply stored and applied.
    const probe: Out = { steps: [], effects: [] };
    if (fromApproved(probe, order, row, signal) !== order.status) {
      out.effects.push({ kind: "store_observation", applied: false, reason: "open_payout_claim" });
      return order.status;
    }
  }
  out.effects.push({ kind: "store_observation", applied: true });
  switch (order.status) {
    case "AWAITING_APPROVAL":
      return fromAwaiting(out, order, row, signal, ctx);
    case "APPROVED":
      return fromApproved(out, order, row, signal);
    case "PAID":
      return fromPaid(out, order, row, signal, ctx);
    case "FROZEN":
    case "REJECTED":
    case "REVERSED":
      return order.status;
  }
}

function firstRow(out: Out, row: ReportObservation, ctx: TransitionContext): OrderStatus | null {
  const attribution = ctx.attribution;
  if (attribution === undefined) throw new TransitionError("attribution_missing", "the first report row of an order needs its attribution");
  const signal = reportSignal(row);
  if (attribution.kind === "review" || (signal.kind === "FREEZE" && signal.reason === "missing_order_id")) {
    out.effects.push({ kind: "open_review_case", reason: attribution.kind === "review" ? attribution.reason : "missing_order_id" });
    return null;
  }
  const order: TransitionOrder = { status: move(out, null, "AWAITING_APPROVAL"), paidAt: null, approvedCommission: null, cashback: null, guest: attribution.guest };
  out.effects.push({ kind: "create_order", customerId: attribution.customerId, guest: attribution.guest });
  return onReport(out, order, row, { ...ctx, review: undefined });
}

function onPayout(out: Out, order: TransitionOrder, observation: Exclude<Observation, { kind: "report" }>): OrderStatus {
  if (observation.kind === "payout_confirmed") {
    if (order.status === "PAID" || order.paidAt !== null) throw new TransitionError("already_paid", "a paid order is never paid again (D4)");
    if (order.status === "APPROVED" && !((order.approvedCommission ?? 0) > 0)) throw new TransitionError("not_payable", "only an approved commission above 0 is payable (R1)");
    const next = move(out, order.status, "PAID");
    out.effects.push({ kind: "set_paid_at" }, { kind: "awards", to: "PAID" });
    return next;
  }
  if (order.status !== "PAID") throw new TransitionError("not_paid", `only a paid order's payout can be voided; this one is ${order.status}`);
  const cancelled = observation.latest !== null && reportSignal(observation.latest).kind === "CANCEL";
  const next = move(out, order.status, cancelled ? "REVERSED" : "APPROVED");
  out.effects.push({ kind: "clear_paid_at" }, { kind: "close_clawback" }, { kind: "awards", to: cancelled ? "VOID" : "CONFIRMED" });
  return next;
}

/** The next state of `order` (null for a row of an order not yet recorded) and the effects to carry out. */
export function transition(order: TransitionOrder | null, observation: Observation, context: TransitionContext): TransitionResult {
  const out: Out = { steps: [], effects: [] };
  let next: OrderStatus | null;
  if (order === null) {
    if (observation.kind !== "report") throw new TransitionError("transition_not_allowed", "only a report row records a new order");
    next = firstRow(out, observation.row, context);
  } else if (observation.kind === "report") {
    next = onReport(out, order, observation.row, context);
  } else {
    next = onPayout(out, order, observation);
  }
  return { next, steps: out.steps, effects: out.effects };
}
