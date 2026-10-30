/**
 * The question Identity asks Ledger: "how much is this customer owed?".
 * Identity defines the port; Ledger answers it. This keeps Identity from
 * importing Ledger, so the two areas never form an import cycle.
 */
export interface OwedAmount {
  /** Approved, unpaid orders (the ones a payout would cover). */
  orderCount: number;
  amountVnd: number;
}

export interface OwedAmountPort {
  owedAmount(customerId: string): OwedAmount;
}
