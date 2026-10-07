import type { Db } from "../../../shared/database/connection";
import { findOrder, markPaid } from "../../orders";
import { planPayout, type PayoutOrder } from "../domain/payout-plan";
import { recordTransfer } from "../infrastructure/payment-transfer.repository";

/**
 * Record a payout and mark its orders paid. The amount is COMPUTED here, not
 * taken from the caller, so a wrong figure cannot reach the bank. Ledger never
 * writes `orders` directly — it asks Orders' `markPaid`, which re-checks that
 * the order is approved and unpaid (never pay twice).
 */
export interface ConfirmPayoutInput {
  customerId: string;
  orderIds: string[];
  confirmedBonusVnd?: number;
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

  const plan = planPayout(orders, []);
  if (!plan.ok) return { ok: false, reason: plan.reason, transferId: null, amountVnd: 0 };

  const amountVnd = plan.totalVnd + (input.confirmedBonusVnd ?? 0);
  const transferId = recordTransfer(db, {
    customerId: input.customerId,
    amountVnd,
    orderIds: input.orderIds,
    note: input.note,
    transferCode: input.transferCode,
    createdAt: input.nowIso,
  });
  for (const orderId of input.orderIds) markPaid(db, orderId, input.nowIso);

  return { ok: true, reason: null, transferId, amountVnd };
}
