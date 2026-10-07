/**
 * What one payout covers. Ports the "confirm payout" rules from
 * `ledger/payouts.py`.
 *
 *   - only APPROVED, unpaid orders can be paid (never pay twice)
 *   - a campaign bonus is paid only when CONFIRMED (a held bonus is not paid)
 *   - there is NO minimum: a single 6,000đ order is payable
 */

/** Kept local so Ledger does not have to import the Orders module's types. */
export type PayableOrderStatus = "awaiting_approval" | "approved" | "paid" | "rejected";

export interface PayoutOrder {
  orderId: string;
  status: PayableOrderStatus;
  paidAt: string | null;
  cashbackVnd: number;
}

export type AwardStatus = "held" | "confirmed" | "paid" | "void";

export interface PayoutAward {
  awardId: string;
  status: AwardStatus;
  bonusVnd: number;
}

export interface PayoutPlan {
  ok: boolean;
  reason: string | null;
  orderIds: string[];
  awardIds: string[];
  totalVnd: number;
}

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

export function planPayout(orders: PayoutOrder[], awards: PayoutAward[]): PayoutPlan {
  const refused = orders.find((order) => order.status !== "approved" || order.paidAt !== null);
  if (refused) {
    return {
      ok: false,
      reason: `order ${refused.orderId} is not payable (${refused.status})`,
      orderIds: [],
      awardIds: [],
      totalVnd: 0,
    };
  }

  const confirmed = awards.filter((award) => award.status === "confirmed");
  return {
    ok: true,
    reason: null,
    orderIds: orders.map((order) => order.orderId),
    awardIds: confirmed.map((award) => award.awardId),
    totalVnd: sum(orders.map((order) => order.cashbackVnd)) + sum(confirmed.map((a) => a.bonusVnd)),
  };
}
