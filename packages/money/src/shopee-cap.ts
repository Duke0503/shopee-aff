/**
 * The Shopee commission cap and the product estimate.
 * Ports `shopee/commission.py::_build` and `core/policy.py`'s cap rule.
 *
 *   total = min(price x shopee_rate, 40,000) + price x seller_rate
 *
 * Shopee caps ITS OWN share of a single order; the shop's XTRA top-up rides
 * on top, uncapped. Rates here are PERCENT (e.g. 7 for 7%).
 */
import { roundDong } from "./rounding";

export const SHOPEE_COMMISSION_CAP_VND = 40_000;

/** The share of the estimate that survives fee and (assumed) tax. */
export const ESTIMATE_NET_RATE = 0.8902; // 1 - 10% withholding - 0.98% service fee

export function capShopeePart(shopeePart: number): number {
  return Math.min(shopeePart, SHOPEE_COMMISSION_CAP_VND);
}

export interface Estimate {
  commission: number;
  price: number;
  totalRate: number;
  shopeeRate: number;
  sellerRate: number;
  shopeePart: number;
  sellerPart: number;
  isCapped: boolean;
}

/** Build a capped estimate from a product's price and commission rates (percent). */
export function buildEstimate(price: number, shopeeRate: number, sellerRate: number): Estimate {
  const rawShopee = (price * shopeeRate) / 100;
  const isCapped = rawShopee > SHOPEE_COMMISSION_CAP_VND;
  const shopeePart = roundDong(capShopeePart(rawShopee));
  const sellerPart = roundDong((price * sellerRate) / 100);

  return {
    commission: shopeePart + sellerPart,
    price,
    totalRate: Math.round((shopeeRate + sellerRate) * 100) / 100,
    shopeeRate,
    sellerRate,
    shopeePart,
    sellerPart,
    isCapped,
  };
}

/**
 * The cashback we SHOW before purchase: `roundDong(roundDong(C x 0.8902) x rate)`.
 * Always subtracts the tax, even in a period that is not withheld; that is
 * today's behaviour (see the ledger open question).
 */
export function estimateCashback(commission: number, cashbackRate: number): number {
  return roundDong(roundDong(commission * ESTIMATE_NET_RATE) * cashbackRate);
}
