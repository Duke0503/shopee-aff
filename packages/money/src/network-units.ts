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
  const { numerator, denominator } = exactUnits(value, scale);
  return roundHalfUp(numerator, denominator);
}

/**
 * A report amount times a whole quantity (a unit price times the number of units),
 * multiplied exactly and rounded once: 1000.5 x 3 is 3,002, not 3 x 1,001.
 */
export function fromNetworkUnitsTimes(value: number | string, scale: number, quantity: number): number {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new RangeError(`quantity must be a whole number of at least 1, received ${quantity}`);
  }
  const { numerator, denominator } = exactUnits(value, scale);
  return roundHalfUp(numerator * BigInt(quantity), denominator);
}

/** `value / scale` as an exact fraction; throws on anything that is not a plain decimal. */
function exactUnits(value: number | string, scale: number): { numerator: bigint; denominator: bigint } {
  if (!Number.isSafeInteger(scale) || scale <= 0) {
    throw new RangeError(`scale must be a positive whole number, received ${scale}`);
  }
  const text = typeof value === "number" ? numberText(value) : value.trim();
  const match = DECIMAL.exec(text);
  if (!match) throw new RangeError(`not a decimal amount: ${String(value)}`);
  const [, sign = "", whole = "0", fraction = ""] = match;
  return { numerator: BigInt(`${sign}${whole}${fraction}`), denominator: BigInt(scale) * 10n ** BigInt(fraction.length) };
}

function numberText(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`not a finite amount: ${value}`);
  if (Number.isSafeInteger(value)) return String(value);
  if (Number.isInteger(value)) throw new RangeError(`amount beyond exact integer range, pass it as a string: ${value}`);
  const text = String(value);
  if (/e/i.test(text)) throw new RangeError(`amount out of exact range: ${value}`);
  return text;
}
