import type { Db } from "../../../shared/database/connection";
import {
  awardsForOrders,
  findOrder,
  markPaid,
  settleCampaignBonusesForOrders,
} from "../../orders";
import { planPayout, type AwardStatus, type PayoutOrder } from "../domain/payout-plan";
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
  nowIso: string;
}

export interface ConfirmPayoutResult {
  ok: boolean;
  reason: string | null;
  transferId: number | null;
  amountVnd: number;
}

export function confirmPayout(db: Db, input: ConfirmPayoutInput): ConfirmPayoutResult {
  const orders: PayoutOrder[] = [];
  for (const orderId of input.orderIds) {
    const row = findOrder(db, orderId);
    if (!row) return { ok: false, reason: `unknown order ${orderId}`, transferId: null, amountVnd: 0 };
    orders.push({
      orderId: row.orderId,
      status: row.status as PayoutOrder["status"],
      paidAt: row.paidAt,
      cashbackVnd: row.cashbackAmount ?? 0,
    });
  }

  const awards = awardsForOrders(db, input.orderIds).map((award) => ({
    awardId: String(award.awardId),
    status: award.status as AwardStatus,
    bonusVnd: award.bonusVnd,
  }));

  const plan = planPayout(orders, awards);
  if (!plan.ok) return { ok: false, reason: plan.reason, transferId: null, amountVnd: 0 };

  const transferId = recordTransfer(db, {
    customerId: input.customerId,
    amountVnd: plan.totalVnd,
    orderIds: input.orderIds,
    note: input.note,
    transferCode: input.transferCode,
    createdAt: input.nowIso,
  });
  for (const orderId of input.orderIds) markPaid(db, orderId, input.nowIso);
  settleCampaignBonusesForOrders(db, input.orderIds, input.nowIso);

  return { ok: true, reason: null, transferId, amountVnd: plan.totalVnd };
}
