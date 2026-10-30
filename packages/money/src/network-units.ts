/**
 * The only entry point for amounts read from a network report (AD-5).
 *
 * Reports carry amounts as integers in a network unit (Shopee's conversion
 * report scales dong by 100,000) or as decimal strings. `fromNetworkUnits`
 * parses them exactly and rounds half-up to whole dong; an adapter never
 * scales or rounds an amount itself.
 */
import { roundHalfUp } from "./rounding";

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

export function fromNetworkUnits(value: number | string, scale: number): number {
  if (!Number.isSafeInteger(scale) || scale <= 0) {
    throw new RangeError(`scale must be a positive whole number, received ${scale}`);
  }
  const text = typeof value === "number" ? numberText(value) : value.trim();
  const match = DECIMAL.exec(text);
  if (!match) throw new RangeError(`not a decimal amount: ${String(value)}`);
  const [, sign = "", whole = "0", fraction = ""] = match;
  const digits = BigInt(`${sign}${whole}${fraction}`);
  const denominator = BigInt(scale) * 10n ** BigInt(fraction.length);
  return roundHalfUp(digits, denominator);
}

function numberText(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`not a finite amount: ${value}`);
  if (Number.isSafeInteger(value)) return String(value);
  if (Number.isInteger(value)) throw new RangeError(`amount beyond exact integer range, pass it as a string: ${value}`);
  const text = String(value);
  if (/e/i.test(text)) throw new RangeError(`amount out of exact range: ${value}`);
  return text;
}
