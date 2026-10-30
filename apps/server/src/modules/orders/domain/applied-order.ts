/**
 * The order as it stands after one `transition` result (AD-7, AD-8): the one reading of the
 * effects that reconciliation (report-apply.command.ts) writes and the shadow run
 * (cutover/shadow-evaluate.ts) predicts, so the shadow report and the ledger cannot disagree on
 * what a report row does to an order.
 */
import { sumDong } from "@cashback/money";

import type { Effect, ReviewCaseReason, TransitionOrder, TransitionResult } from "./transition";

export type ApprovalEffect = Extract<Effect, { kind: "store_cashback" }>;

export interface AppliedStep {
  /** The order after the row; the order before it when the row records or changes nothing. */
  readonly order: TransitionOrder | null;
  /** True when the row leaves an order (new or existing) in the state `transition` gave. */
  readonly applied: boolean;
  /** The customer of an order this row recorded; null for an existing order or none. */
  readonly createdFor: string | null;
  /** The cashback and split stored at approval, when this row approved the order. */
  readonly approval: ApprovalEffect | null;
  /** What this row claws back, in dong (0 when nothing). */
  readonly clawback: number;
  readonly reviewCases: readonly ReviewCaseReason[];
  /** The row was stored but not applied because a payout claim is open (D39). */
  readonly deferred: boolean;
}

export function applyResult(before: TransitionOrder | null, result: TransitionResult): AppliedStep {
  let order = before;
  let createdFor: string | null = null;
  let approval: ApprovalEffect | null = null;
  const clawbacks: number[] = [];
  const reviewCases: ReviewCaseReason[] = [];
  let deferred = false;
  for (const e of result.effects) {
    if (e.kind === "create_order") {
      createdFor = e.customerId;
      order = { status: "AWAITING_APPROVAL", paidAt: null, approvedCommission: null, cashback: null, guest: e.guest };
    }
    if (e.kind === "store_cashback" && order !== null) {
      approval = e;
      order = { ...order, approvedCommission: e.approvedCommission, cashback: e.cashback };
    }
    if (e.kind === "clawback") clawbacks.push(e.amount);
    if (e.kind === "open_review_case") reviewCases.push(e.reason);
    if (e.kind === "store_observation" && !e.applied) deferred = true;
  }
  const next = order !== null && result.next !== null ? { ...order, status: result.next } : null;
  return {
    order: next ?? before,
    applied: next !== null,
    createdFor,
    approval,
    clawback: sumDong(clawbacks, "clawback"),
    reviewCases,
    deferred,
  };
}
