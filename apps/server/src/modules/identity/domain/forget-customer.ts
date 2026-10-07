import type { OwedAmount } from "./owed-amount.port";

/**
 * Whether a customer may be erased. Ports `ledger/repository.py::forget_customer`.
 *
 * Deleting a record that says you owe someone 20,000đ does not end the
 * obligation, it just hides it — so the delete is refused while money is
 * still owed, unless an admin passes `force` (after settling it some other way).
 */
export interface ForgetDecision {
  found: boolean;
  deleted: boolean;
  owedOrders?: number;
  owedAmount?: number;
}

export function decideForget(found: boolean, owed: OwedAmount, force: boolean): ForgetDecision {
  if (!found) return { found: false, deleted: false };
  if (owed.orderCount > 0 && !force) {
    return {
      found: true,
      deleted: false,
      owedOrders: owed.orderCount,
      owedAmount: owed.amountVnd,
    };
  }
  return { found: true, deleted: true };
}
