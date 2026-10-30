/**
 * Commission from a price and rates, with the Shopee cap (D2).
 *
 *   commission = min(price x shopeeRate, 40,000) + price x xtraRate
 *
 * Rates are basis points (300 = 3%). Each part is rounded half-up once.
 */
import { assertNonNegativeDong, roundHalfUp } from "./rounding";
import { BPS, SHOPEE_COMMISSION_CAP_DONG } from "./network-rules";

export interface CommissionParts {
  shopeePart: number;
  xtraPart: number;
  commission: number;
  capped: boolean;
}

function assertBps(value: number, label: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new RangeError(`${label} must be whole basis points between 0 and 10000, received ${value}`);
  }
  return BigInt(value);
}

export function shopeeCommission(price: number, shopeeRateBps: number, xtraRateBps: number): CommissionParts {
  const p = BigInt(assertNonNegativeDong(price, "price"));
  const rawShopee = p * assertBps(shopeeRateBps, "shopeeRateBps");
  const capRaw = BigInt(SHOPEE_COMMISSION_CAP_DONG) * BPS;
  const capped = rawShopee > capRaw;
  const shopeePart = roundHalfUp(capped ? capRaw : rawShopee, BPS);
  const xtraPart = roundHalfUp(p * assertBps(xtraRateBps, "xtraRateBps"), BPS);
  return { shopeePart, xtraPart, commission: shopeePart + xtraPart, capped };
}

/** Commission when the network already reports the two parts in dong. */
export function cappedCommission(shopeePart: number, xtraPart: number): number {
  assertNonNegativeDong(shopeePart, "shopeePart");
  assertNonNegativeDong(xtraPart, "xtraPart");
  return Math.min(shopeePart, SHOPEE_COMMISSION_CAP_DONG) + xtraPart;
}
