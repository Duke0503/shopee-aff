/**
 * The commission split (FR-13, D34): how one approved commission becomes cashback.
 *
 *   fee      = commission x feeBps            (shown rounded half-up)
 *   tax      = commission x 10% when withheld (shown rounded half-up)
 *   net      = commission - fee - tax
 *   cashback = roundHalfUp(exactNet x 80%)    the only rounding a customer feels
 *   operator = commission - fee - tax - cashback
 *
 * `exactNet` is the unrounded commission x (1 - fee - tax), kept as an exact
 * fraction, so the cashback never inherits a rounded fee or tax.
 */
import { assertNonNegativeDong, roundHalfUp } from "./rounding";
import {
  BPS,
  CASHBACK_SHARE_BPS,
  NETWORK_MONEY_RULES,
  WITHHOLDING_TAX_BPS,
  type AffiliateNetwork,
} from "./network-rules";

export interface SplitInput {
  approvedCommission: number;
  network: AffiliateNetwork;
  /** Whether the order's settlement period is withheld. Ignored for networks that always withhold. */
  withheld: boolean;
  /** The guest account (HOUSE) never earns cashback (D5). */
  guest?: boolean;
}

export interface Split {
  approvedCommission: number;
  fee: number;
  tax: number;
  net: number;
  cashback: number;
  operatorShare: number;
}

export function isWithheld(network: AffiliateNetwork, periodWithheld: boolean): boolean {
  return NETWORK_MONEY_RULES[network].alwaysWithheld || periodWithheld;
}

export function splitCommission(input: SplitInput): Split {
  const commission = assertNonNegativeDong(input.approvedCommission, "approvedCommission");
  const rules = NETWORK_MONEY_RULES[input.network];
  const taxBps = isWithheld(input.network, input.withheld) ? WITHHOLDING_TAX_BPS : 0n;
  const c = BigInt(commission);

  const fee = roundHalfUp(c * rules.feeBps, BPS);
  const tax = roundHalfUp(c * taxBps, BPS);
  const net = commission - fee - tax;
  const exactNetTimesBps = c * (BPS - rules.feeBps - taxBps);
  const cashback = input.guest ? 0 : roundHalfUp(exactNetTimesBps * CASHBACK_SHARE_BPS, BPS * BPS);
  const operatorShare = commission - fee - tax - cashback;

  return { approvedCommission: commission, fee, tax, net, cashback, operatorShare };
}
