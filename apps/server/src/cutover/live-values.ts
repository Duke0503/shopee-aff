/**
 * Reading live amounts (AD-5): an amount is kept only when it is already a whole-dong safe
 * integer; anything else (a float, text, a negative) is not one, and the caller lists it. Zero is
 * a real amount for stored money (a 0 commission) and no information for a quoted price, so each
 * caller says which it reads.
 */

export function wholeDong(value: unknown, options: { allowZero: boolean }): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return null;
  return value > 0 || (options.allowZero && value === 0) ? value : null;
}
