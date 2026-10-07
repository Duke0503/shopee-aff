/**
 * Withholding tax and the policy warnings that go with it.
 * Mirrors `core/policy.py` (WITHHOLDING_TAX_RATE, WITHHOLDING_THRESHOLD_VND,
 * policy_warnings).
 */

/** Personal income tax withheld at source on a single Shopee payout. */
export const WITHHOLDING_TAX_RATE = 0.1;

/** Shopee withholds the 10% only when one payout reaches this amount. */
export const WITHHOLDING_THRESHOLD_VND = 2_000_000;

/** Who carries the 10% tax in a withheld period. */
export type TaxPolicy = "owner_absorbs" | "user_absorbs";

/** True when a payout of this size is at or above the withholding threshold. */
export function shouldWithhold(monthlyCommissionTotal: number): boolean {
  return monthlyCommissionTotal >= WITHHOLDING_THRESHOLD_VND;
}

const percent = (value: number): string => `${(value * 100).toFixed(0)}%`;
const dong = (value: number): string => value.toLocaleString("en-US");

/**
 * Checks to surface before going live. Empty list means nothing to flag.
 * Only `user_absorbs` produces warnings; `owner_absorbs` returns none, so
 * customers always receive the advertised rate.
 */
export function policyWarnings(
  taxPolicy: TaxPolicy,
  cashbackRate: number,
  expectedMonthlyCommission: number,
): string[] {
  if (taxPolicy !== "user_absorbs") return [];

  const actualShare = cashbackRate - WITHHOLDING_TAX_RATE;

  if (expectedMonthlyCommission >= WITHHOLDING_THRESHOLD_VND) {
    return [
      `Expected commission ${dong(expectedMonthlyCommission)} VND/month is at or above the ` +
        `${dong(WITHHOLDING_THRESHOLD_VND)} VND threshold, so every payout period is withheld ` +
        `at ${percent(WITHHOLDING_TAX_RATE)}.`,
      `Customers will NEVER receive ${percent(cashbackRate)}. They always receive ` +
        `${percent(actualShare)}.`,
      `Advertising '${percent(cashbackRate)}' is therefore false. Advertise ` +
        `'${percent(actualShare)}' instead: it is stable and it is true.`,
    ];
  }

  return [
    `Cashback will swing between ${percent(actualShare)} and ${percent(cashbackRate)} depending ` +
      `on whether the month clears the ${dong(WITHHOLDING_THRESHOLD_VND)} VND threshold.`,
    `Customers cannot see or control that variable. Two customers with identical orders will ` +
      `receive different amounts.`,
  ];
}
