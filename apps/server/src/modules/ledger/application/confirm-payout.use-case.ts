import type { Db } from "../../../shared/database/connection";
import {
  awardsForOrders,
  findOrder,
  markPaid,
  settleCampaignBonusesForOrders,
} from "../../orders";
import { createBillToken } from "../domain/bill";
import { planPayout, type AwardStatus, type PayoutOrder, type PayoutPlan } from "../domain/payout-plan";
import { recordTransfer } from "../infrastructure/payment-transfer.repository";

/**
 * Record a payout and mark its orders paid. The amount is COMPUTED here from
 * the saved cashback plus the orders' CONFIRMED campaign bonuses, never taken
 * from the caller, so a wrong figure cannot reach the bank. Ledger never writes
 * `orders` or `campaign_awards` directly — it asks Orders' `markPaid` (which
 * re-checks approved and unpaid) and `settleCampaignBonusesForOrders`, so a
 * bonus is never sent twice.
 */
export interface ConfirmPayoutInput {
  customerId: string;
  orderIds: string[];
  note: string;
  transferCode: string;
  /** The uploaded screenshot of the bank transfer, as a URL; optional. */
  proofImage?: string;
  nowIso: string;
}

export interface ConfirmPayoutResult {
  ok: boolean;
  reason: string | null;
  transferId: number | null;
  amountVnd: number;
  /** The bill the customer can be sent to; empty when nothing was recorded. */
  billToken: string;
}

const failure = (reason: string): ConfirmPayoutResult => ({
  ok: false,
  reason,
  transferId: null,
  amountVnd: 0,
  billToken: "",
});

/**
 * What a payout of these orders would cover, worked out from the database and
 * written nowhere. `confirmPayout` uses it to record; a screen that must not
 * record anything uses it to check a figure it shows the owner.
 */
export function planPayoutFromDb(db: Db, orderIds: string[]): PayoutPlan {
  const orders: PayoutOrder[] = [];
  for (const orderId of orderIds) {
    const row = findOrder(db, orderId);
    if (!row) return { ok: false, reason: `unknown order ${orderId}`, orderIds: [], awardIds: [], totalVnd: 0 };
    orders.push({
      orderId: row.orderId,
      status: row.status as PayoutOrder["status"],
      paidAt: row.paidAt,
      cashbackVnd: row.cashbackAmount ?? 0,
    });
  }

  const awards = awardsForOrders(db, orderIds).map((award) => ({
    awardId: String(award.awardId),
    status: award.status as AwardStatus,
    bonusVnd: award.bonusVnd,
  }));

  return planPayout(orders, awards);
}

export function confirmPayout(db: Db, input: ConfirmPayoutInput): ConfirmPayoutResult {
  const plan = planPayoutFromDb(db, input.orderIds);
  if (!plan.ok) return failure(plan.reason ?? "payout failed");

  const billToken = createBillToken();
  const transferId = recordTransfer(db, {
    customerId: input.customerId,
    amountVnd: plan.totalVnd,
    orderIds: input.orderIds,
    note: input.note,
    transferCode: input.transferCode,
    proofImage: input.proofImage ?? null,
    billToken,
    createdAt: input.nowIso,
  });
  for (const orderId of input.orderIds) markPaid(db, orderId, input.nowIso);
  settleCampaignBonusesForOrders(db, input.orderIds, input.nowIso);

  return { ok: true, reason: null, transferId, amountVnd: plan.totalVnd, billToken };
}
