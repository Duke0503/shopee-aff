/**
 * Refuse orders we would be unable to settle two months from now. Ports
 * `ledger/repository.py::can_accept_orders`. Without a private chat the bot
 * cannot tell the customer their commission was approved, so the payout
 * would silently strand; without a bank account there is nowhere to send it.
 */
export interface OrderEligibilityInput {
  privateChatId: string | null;
  bankAccount: string | null;
}

export interface Eligibility {
  ok: boolean;
  reason: string;
}

export function canAcceptOrders(customer: OrderEligibilityInput): Eligibility {
  if (!customer.privateChatId) {
    return { ok: false, reason: "customer has never messaged the bot privately" };
  }
  if (!customer.bankAccount) {
    return { ok: false, reason: "no bank account on file" };
  }
  return { ok: true, reason: "" };
}
