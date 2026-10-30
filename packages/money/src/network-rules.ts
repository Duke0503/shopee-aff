/**
 * Per-network money rules in basis points (1 bp = 0.01%), D12, D20, D54.
 *
 * Shopee keeps a 0.98% service fee and withholds 10% personal income tax only
 * in a withheld settlement period. AccessTrade pays net of its own fee and
 * always withholds 10%. The customer receives 80% of net on every network.
 */

export type AffiliateNetwork = "shopee" | "accesstrade";

export const BPS = 10_000n;

export const CASHBACK_SHARE_BPS = 8_000n;

export const WITHHOLDING_TAX_BPS = 1_000n;

export interface NetworkMoneyRules {
  feeBps: bigint;
  alwaysWithheld: boolean;
}

export const NETWORK_MONEY_RULES: Record<AffiliateNetwork, NetworkMoneyRules> = {
  shopee: { feeBps: 98n, alwaysWithheld: false },
  accesstrade: { feeBps: 0n, alwaysWithheld: true },
};

/** Shopee caps its own part of one order's commission; the shop's XTRA part is not capped (D2). */
export const SHOPEE_COMMISSION_CAP_DONG = 40_000;
