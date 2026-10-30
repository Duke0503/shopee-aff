/**
 * The affiliate network catalog (AD-22, D17, D18, D20): every per-network rule in one
 * place, read by other modules through the linking module's index. The fee rate and the
 * tax rule are the money package's own values (D20: the split is one function in
 * `packages/money`), published here so no module keeps a second copy. Shopee and
 * AccessTrade only; Lazada is out of the first release (D17).
 */
import { NETWORK_MONEY_RULES, PERIOD_WITHHELD_BY_DEFAULT, SHOPEE_COMMISSION_CAP_DONG, type AffiliateNetwork } from "@cashback/money";

import { ACCESSTRADE_AMOUNT_SCALE, ACCESSTRADE_STATUS_MAP } from "./accesstrade-report";
import type { StatusMap } from "./network-status";
import { SHOPEE_AMOUNT_SCALE, SHOPEE_STATUS_MAP } from "./shopee-report";

/**
 * `per_period`: withheld only in a withheld settlement period, which is the default until
 * staff unmark it (D54). `always`: the network always withholds 10%. Both are read from
 * `@cashback/money` (`NETWORK_MONEY_RULES`, `PERIOD_WITHHELD_BY_DEFAULT`), never kept here.
 */
export type TaxRule = { kind: "per_period"; withheldByDefault: boolean } | { kind: "always" };

/** `network_part`: the network's own part of one order's commission is capped; the shop's XTRA part is not (D2). */
export type CapRule = { kind: "network_part"; capDong: number } | { kind: "none" };

export interface SubIdFormat {
  /** Every sub_id is letters and digits only (D7). */
  readonly pattern: RegExp;
  readonly count: number;
  /** Where the report carries them back. */
  readonly reportField: string;
}

export interface NetworkDefinition {
  readonly network: AffiliateNetwork;
  /** Basis points of the commission the network keeps as a fee. */
  readonly feeBps: bigint;
  readonly taxRule: TaxRule;
  readonly capRule: CapRule;
  readonly subIdFormat: SubIdFormat;
  /** Report amounts are `fromNetworkUnits(value, amountScale)`. */
  readonly amountScale: number;
  readonly reportShape: "shopee_conversion_report" | "accesstrade_transactions";
  readonly statusMap: StatusMap;
}

const SUB_ID = /^[a-zA-Z0-9]*$/;

function taxRuleOf(network: AffiliateNetwork): TaxRule {
  return NETWORK_MONEY_RULES[network].alwaysWithheld ? { kind: "always" } : { kind: "per_period", withheldByDefault: PERIOD_WITHHELD_BY_DEFAULT };
}

export const NETWORK_CATALOG: Readonly<Record<AffiliateNetwork, NetworkDefinition>> = Object.freeze({
  shopee: {
    network: "shopee",
    feeBps: NETWORK_MONEY_RULES.shopee.feeBps,
    taxRule: taxRuleOf("shopee"),
    capRule: { kind: "network_part", capDong: SHOPEE_COMMISSION_CAP_DONG },
    subIdFormat: { pattern: SUB_ID, count: 5, reportField: "utm_content" },
    amountScale: SHOPEE_AMOUNT_SCALE,
    reportShape: "shopee_conversion_report",
    statusMap: SHOPEE_STATUS_MAP,
  },
  accesstrade: {
    network: "accesstrade",
    feeBps: NETWORK_MONEY_RULES.accesstrade.feeBps,
    taxRule: taxRuleOf("accesstrade"),
    capRule: { kind: "none" },
    subIdFormat: { pattern: SUB_ID, count: 5, reportField: "_extra.sub_params" },
    amountScale: ACCESSTRADE_AMOUNT_SCALE,
    reportShape: "accesstrade_transactions",
    statusMap: ACCESSTRADE_STATUS_MAP,
  },
});

export function networkDefinition(network: AffiliateNetwork): NetworkDefinition {
  return NETWORK_CATALOG[network];
}

