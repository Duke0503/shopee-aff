/**
 * The cashback split: how one APPROVED commission becomes cashback.
 * Ports `core/policy.py::split_commission`, matching today's code to the dong.
 *
 *   fee      = round(C x 0.98%)                 (legacy: half to even)
 *   tax      = round(C x 10%)  only in a withheld period
 *   net      = C - fee - tax
 *   receives = roundDong(net x cashback_rate)    (half up)
 *   keeps    = net - receives
 */
import { legacyRoundHalfEven, roundDong } from "./rounding";
import { WITHHOLDING_TAX_RATE, type TaxPolicy } from "./tax";

/** Shopee Affiliate service fee, VAT included (0.98% of what Shopee pays us). */
export const SERVICE_FEE_RATE = 0.0098;

export interface Split {
  approvedCommission: number;
  serviceFee: number;
  withheldTax: number;
  nominalCashback: number;
  customerReceives: number;
  operatorKeeps: number;
}

const ZERO_SPLIT: Split = {
  approvedCommission: 0,
  serviceFee: 0,
  withheldTax: 0,
  nominalCashback: 0,
  customerReceives: 0,
  operatorKeeps: 0,
};

/**
 * Split one approved order.
 *
 * `approvedCommission` must be the figure the platform actually approved,
 * never the estimate shown at link-creation time.
 *
 * `taxPolicy` is accepted for API parity with Python but is IGNORED, exactly
 * as today's code ignores it: in a withheld period the 10% always comes out of
 * the customer's share. See the open question in the ledger doc.
 */
export function splitCommission(
  approvedCommission: number,
  cashbackRate: number,
  periodIsWithheld: boolean,
  _taxPolicy: TaxPolicy = "user_absorbs",
): Split {
  if (approvedCommission <= 0) {
    return { ...ZERO_SPLIT };
  }

  const serviceFee = legacyRoundHalfEven(approvedCommission * SERVICE_FEE_RATE);
  const withheldTax = periodIsWithheld
    ? legacyRoundHalfEven(approvedCommission * WITHHOLDING_TAX_RATE)
    : 0;
  const net = approvedCommission - serviceFee - withheldTax;
  const customerReceives = roundDong(net * cashbackRate);
  const operatorKeeps = net - customerReceives;

  return {
    approvedCommission,
    serviceFee,
    withheldTax,
    nominalCashback: customerReceives,
    customerReceives,
    operatorKeeps,
  };
}
