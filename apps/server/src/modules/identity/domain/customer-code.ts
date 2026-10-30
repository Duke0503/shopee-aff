/**
 * Customer codes (AD-23, FR-8): `DP` plus five digits, issued from a counter that only goes
 * up, so a code in an old bank transfer only ever means one person. The live format is kept.
 */

export const CUSTOMER_CODE_PREFIX = "DP";
export const CUSTOMER_CODE_DIGITS = 5;

const CODE = /^DP(\d+)$/;

export function formatCustomerCode(n: number): string {
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(`not a customer code number: ${n}`);
  return `${CUSTOMER_CODE_PREFIX}${String(n).padStart(CUSTOMER_CODE_DIGITS, "0")}`;
}

/** The number of a `DP` code typed in any case, or null when the text is not one. */
export function customerCodeNumber(text: string): number | null {
  const m = CODE.exec(text.trim().toUpperCase());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** The counter value that keeps every code already seen (live, retired or counted) from reuse. */
export function counterAbove(counterLast: number, codes: readonly string[]): number {
  return codes.reduce((top, code) => Math.max(top, customerCodeNumber(code) ?? 0), Math.max(0, counterLast));
}
