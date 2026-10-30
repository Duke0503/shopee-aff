/**
 * The shared definitions (AD-10, FR-38, D27): payable, waiting for approval, paid,
 * settled and has a bank account. The live system had two or three meanings for each
 * (list-defects root cause 4); here each has exactly one. The payable balance itself is
 * a sum computed by the payouts module (AD-6); these say which rows count.
 */
import type { CampaignAwardStatus, NetworkSettlementStatus, OrderStatus } from "./registry";

/** FROZEN and REVERSED orders count in no total (D5, AD-6). */
export const ORDER_STATUSES_IN_NO_TOTAL: readonly OrderStatus[] = ["FROZEN", "REVERSED"];

export interface PayableOrderFacts {
  status: OrderStatus;
  paidAt: string | null;
  approvedCommission: number;
}

/** Payable: APPROVED, not paid, with an approved commission above 0 (status-flows R1). */
export function isPayableOrder(order: PayableOrderFacts): boolean {
  return order.status === "APPROVED" && order.paidAt === null && order.approvedCommission > 0;
}

/** A campaign bonus is payable once CONFIRMED, and is suspended while its order is FROZEN (D55). */
export function isPayableAward(award: { status: CampaignAwardStatus; orderStatus: OrderStatus }): boolean {
  return award.status === "CONFIRMED" && award.orderStatus !== "FROZEN";
}

/** Waiting for approval: the network has not decided. A FROZEN order is not waiting; it is in no total. */
export function isWaitingForApproval(status: OrderStatus): boolean {
  return status === "AWAITING_APPROVAL";
}

/** Paid: covered by a recorded payout. */
export function isPaidOrder(status: OrderStatus): boolean {
  return status === "PAID";
}

/** Settled: the network paid the batch covering the order. It never changes the order's status (D27). */
export function isSettled(settlement: NetworkSettlementStatus | null): boolean {
  return settlement === "PAID";
}

export type SettlementFact = "UNSETTLED" | "PARTLY_SETTLED" | "SETTLED";

/** The settled fact for a set of orders, such as one payout's covered orders. */
export function settlementOf(settlements: readonly (NetworkSettlementStatus | null)[]): SettlementFact {
  const settled = settlements.filter(isSettled).length;
  if (settled === 0) return "UNSETTLED";
  return settled === settlements.length ? "SETTLED" : "PARTLY_SETTLED";
}

/** Has a bank account: one is saved and it is not waiting for confirmation in Zalo. */
export function hasBankAccount(account: { pendingConfirmation: boolean } | null): boolean {
  return account !== null && !account.pendingConfirmation;
}
