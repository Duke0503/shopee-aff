/**
 * The order life cycle. Ports `ledger/repository.py`'s statuses and
 * ALLOWED_TRANSITIONS: states only ever move forward, and an order that
 * already has `paid_at` is never touched again (we never pay twice).
 *
 *   awaiting_approval ──► approved ──► paid   (end)
 *          └───────────► rejected           (end)
 */
export const AWAITING_APPROVAL = "awaiting_approval";
export const APPROVED = "approved";
export const PAID = "paid";
export const REJECTED = "rejected";

export type OrderStatus = "awaiting_approval" | "approved" | "paid" | "rejected";

export const ALLOWED_TRANSITIONS: Record<OrderStatus, ReadonlySet<OrderStatus>> = {
  awaiting_approval: new Set([APPROVED, REJECTED]),
  approved: new Set([PAID]),
  paid: new Set(),
  rejected: new Set(),
};

export interface OrderRef {
  status: OrderStatus;
  paidAt: string | null;
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from].has(to);
}

/** Paid and rejected are terminal; a paid_at date makes any order terminal. */
export function isFinal(order: OrderRef): boolean {
  return order.paidAt !== null || order.status === PAID || order.status === REJECTED;
}

/**
 * "Mark paid" refuses anything not approved; a second call does nothing.
 * Reconciliation also skips any order where isFinal() is true.
 */
export function assertMarkPaidAllowed(order: OrderRef): void {
  if (order.paidAt !== null) return;
  if (order.status !== APPROVED) {
    throw new Error(`mark paid refused: order is ${order.status}, not approved`);
  }
}

/**
 * The status after a reconciliation report. Never guesses: a terminal order
 * is left alone, an approved order stays approved even if the report now says
 * cancelled, and any other move must be an allowed transition.
 */
export function statusAfterReport(order: OrderRef, reported: OrderStatus): OrderStatus {
  if (isFinal(order) || order.status === APPROVED) return order.status;
  return canTransition(order.status, reported) ? reported : order.status;
}

/** An approval needs an approved commission; with none, the row goes to review. */
export function canApprove(approvedCommission: number | null | undefined): boolean {
  return approvedCommission !== null && approvedCommission !== undefined;
}
