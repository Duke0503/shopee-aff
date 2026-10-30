/**
 * Which withheld setting an order's split uses (FR-13, AD-5, D54), shared by the ledger apply
 * (report-apply.command.ts) and the shadow run (cutover/shadow-evaluate.ts) so the two cannot
 * disagree. An approval belongs to the settlement period of its Vietnam month; the network rules
 * of `@cashback/money` decide whether a period is withheld (AccessTrade always; Shopee unless
 * staff unmarked it). A new approval, from AWAITING_APPROVAL, reads its period's setting now and
 * stamps the period, the time and the setting together. An order approved before keeps the
 * setting it was approved with; an imported approval has none stored and was withheld live.
 */
import { vnDateOf, type Instant, type OrderStatus } from "@cashback/core";
import { isWithheld, PERIOD_WITHHELD_BY_DEFAULT, type AffiliateNetwork } from "@cashback/money";

/** The Vietnam month (`YYYY-MM`) an approval at `at` belongs to. */
export const settlementPeriodOf = (at: Instant): string => vnDateOf(at).slice(0, 7);

/** A period's withheld setting from the staff mark on it, or null when there is none. */
export const periodIsWithheld = (network: AffiliateNetwork, mark: boolean | null): boolean => isWithheld(network, mark ?? PERIOD_WITHHELD_BY_DEFAULT);

export interface SplitHolder {
  readonly status: OrderStatus;
  /** The setting stored with the order's approval; null before one, or for an imported approval. */
  readonly cashbackWithheld: boolean | null;
}

/** The setting the split uses; `periodNow` is read only when the row would be a new approval. */
export const splitWithheld = (order: SplitHolder | null, periodNow: () => boolean): boolean =>
  order === null || order.status === "AWAITING_APPROVAL" ? periodNow() : (order.cashbackWithheld ?? true);
