import type { Db } from "../../../shared/database/connection";
import { payableOrderIdsForCustomer } from "../infrastructure/payables.repository";
import { confirmPayout, planPayoutFromDb, type ConfirmPayoutResult } from "./confirm-payout.use-case";

/**
 * The owner recording a transfer they have already made in their banking app,
 * from the customer's page.
 *
 * Which orders it covers is worked out HERE: the ones named, or — when none are
 * named — everything approved and unpaid for that customer. The amount is never
 * taken from the request. `expectedAmountVnd` is only an assertion: when the
 * caller sends the figure their screen showed, a payout that no longer comes to
 * that sum is refused instead of silently recording a different one.
 */
export interface RecordTransferInput {
  customerId: string;
  /** The orders to pay; empty means every payable order of the customer. */
  orderIds: string[];
  /** The total the caller expected us to owe, or null to skip the check. */
  expectedAmountVnd: number | null;
  note: string;
  transferCode: string;
  proofImage: string;
  nowIso: string;
}

const failure = (reason: string): ConfirmPayoutResult => ({
  ok: false,
  reason,
  transferId: null,
  amountVnd: 0,
  billToken: "",
});

export function recordTransferForCustomer(db: Db, input: RecordTransferInput): ConfirmPayoutResult {
  const orderIds =
    input.orderIds.length > 0 ? input.orderIds : payableOrderIdsForCustomer(db, input.customerId);
  if (orderIds.length === 0) {
    return failure("this customer has no approved, unpaid orders");
  }

  const plan = planPayoutFromDb(db, orderIds);
  if (!plan.ok) return failure(plan.reason ?? "transfer failed");
  if (input.expectedAmountVnd !== null && input.expectedAmountVnd !== plan.totalVnd) {
    return failure(`amount ${input.expectedAmountVnd} does not match the orders (${plan.totalVnd})`);
  }

  return confirmPayout(db, {
    customerId: input.customerId,
    orderIds,
    note: input.note,
    transferCode: input.transferCode,
    proofImage: input.proofImage,
    nowIso: input.nowIso,
  });
}
