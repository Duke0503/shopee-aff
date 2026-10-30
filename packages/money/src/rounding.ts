/**
 * Whole-dong integers and the one rounding rule (D1, AD-5).
 *
 * Every amount is a safe integer number of dong. Intermediate maths that can
 * leave the safe range is done in BigInt as an exact fraction, and the only
 * rounding is `roundHalfUp` on that fraction: 9,262.5 becomes 9,263.
 */

/** Throw unless `value` is a whole number of dong inside the safe integer range. */
export function assertDong(value: number, label = "amount"): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe whole number of dong, received ${value}`);
  }
  return value;
}

/** Throw unless `value` is a non-negative whole number of dong. */
export function assertNonNegativeDong(value: number, label = "amount"): number {
  assertDong(value, label);
  if (value < 0) throw new RangeError(`${label} must not be negative, received ${value}`);
  return value;
}

/**
 * Round the exact fraction `numerator / denominator` to whole dong, halves away
 * from zero: 2.5 becomes 3 and -2.5 becomes -3, so a clawback mirrors the
 * cashback it reverses to the dong.
 */
export function roundHalfUp(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) throw new RangeError("denominator must be positive");
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const rounded = (2n * abs + denominator) / (2n * denominator);
  const result = Number(negative ? -rounded : rounded);
  return assertDong(result, "rounded amount");
}
