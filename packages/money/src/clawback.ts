/**
 * Sums and clawback amounts (AD-6, D30, D35, D42, D55). A clawback after payout takes back the
 * order's stored cashback plus any campaign bonus already paid on it; a commission drop after
 * payout takes back only the difference between the stored cashback and the cashback the lower
 * commission gives. Both subtract what earlier clawback entries already took, so a second report
 * of the same cancel never claws back twice, and neither is ever negative. A clawback's open
 * amount is the signed sum of its insert-only ledger entries (D42): negative while money is owed.
 */
import { assertDong, assertNonNegativeDong } from "./rounding";

/** The sum of whole-dong amounts; throws on a non-integer or a sum outside the safe range. */
export function sumDong(values: readonly number[], label = "amount"): number {
  let total = 0;
  for (const value of values) {
    total += assertNonNegativeDong(value, label);
    if (!Number.isSafeInteger(total)) throw new RangeError(`${label}: sum leaves the safe integer range`);
  }
  return total;
}

/** `a - b` for two whole-dong amounts, either sign; for reports of a difference, never stored. */
export function differenceDong(a: number, b: number): number {
  return assertDong(assertDong(a, "a") - assertDong(b, "b"), "difference");
}

export interface ClawbackInput {
  /** The cashback stored on the paid order. */
  storedCashback: number;
  /** Campaign bonus already paid on the order (D35); 0 when none. */
  paidBonus: number;
  /** The amount earlier clawback originals on this order already took, as a positive number. */
  alreadyClawedBack: number;
}

/** A cancel after payout (D30, D35): everything paid on the order that is not taken back yet. */
export function clawbackAmount(input: ClawbackInput): number {
  const owed = sumDong([input.storedCashback, input.paidBonus], "clawback");
  return Math.max(0, owed - assertNonNegativeDong(input.alreadyClawedBack, "alreadyClawedBack"));
}

export interface PartialClawbackInput {
  storedCashback: number;
  /** The cashback the lower approved commission gives, from `splitCommission`. */
  newCashback: number;
  alreadyClawedBack: number;
}

/** A commission drop after payout (D55): the cashback paid above what the new commission earns. */
export function partialClawbackAmount(input: PartialClawbackInput): number {
  const stored = assertNonNegativeDong(input.storedCashback, "storedCashback");
  const lower = assertNonNegativeDong(input.newCashback, "newCashback");
  return Math.max(0, stored - lower - assertNonNegativeDong(input.alreadyClawedBack, "alreadyClawedBack"));
}

/**
 * The open amount of one clawback (D42): the sum of its ledger entries, the negative original and
 * the positive netting, write-off and offset entries. Negative while money is still owed back.
 */
export function clawbackOpenAmount(entries: readonly number[]): number {
  let total = 0;
  for (const entry of entries) {
    total = assertDong(total + assertDong(entry, "ledger entry"), "clawback open amount");
  }
  return total;
}

/**
 * What a payout void credit still owes the customer (Story 4.10): the sum of its entries, the
 * positive NETTING_REFUND and the negative REFUND_PAID of the payout that paid it, never below 0.
 */
export function creditOpenAmount(entries: readonly number[]): number {
  return Math.max(0, clawbackOpenAmount(entries));
}
