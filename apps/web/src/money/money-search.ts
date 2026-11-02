/**
 * My money's URL state (LC-4, Stories 7.3 and 7.4): the view (order lines, payouts, or the
 * clawed-back orders) and that view's own list search, filter, sort and page, in the form the list
 * endpoint takes. A figure on the balance card is a link to the view and filter whose rows add up
 * to it. The router reads this in the first script, so it holds no schema and no query.
 */
import { listSearch, MY_ORDERS_SEARCH_SPEC, MY_PAYOUTS_SEARCH_SPEC, type ListSearchState } from "@cashback/contracts";

export const MY_ORDERS_SEARCH = listSearch(MY_ORDERS_SEARCH_SPEC);
export const MY_PAYOUTS_SEARCH = listSearch(MY_PAYOUTS_SEARCH_SPEC);

export const MONEY_VIEWS = ["orders", "payouts", "deducted"] as const;
export type MoneyView = (typeof MONEY_VIEWS)[number];

export const viewOf = (raw: unknown): MoneyView => ((MONEY_VIEWS as readonly unknown[]).includes(raw) ? (raw as MoneyView) : "orders");

/** The page's URL search: the view (absent for the order lines) and that view's own list state. */
export function moneySearch(raw: Record<string, unknown>): Record<string, string> {
  const view = viewOf(raw["view"]);
  if (view === "deducted") return { view };
  if (view === "payouts") return { view, ...MY_PAYOUTS_SEARCH.validate(raw) };
  return MY_ORDERS_SEARCH.validate(raw);
}

/** The URL search of a view with a list state (the card's figures link here). */
export function moneyLink(view: MoneyView, state?: ListSearchState): Record<string, string> {
  if (view === "deducted") return { view };
  if (view === "payouts") return { view, ...(state === undefined ? {} : MY_PAYOUTS_SEARCH.toParams(state)) };
  return state === undefined ? {} : MY_ORDERS_SEARCH.toParams(state);
}

/** The order lines filtered to one status, as the card's figures open them. */
export const ordersWithStatus = (status: string): ListSearchState => ({ ...MY_ORDERS_SEARCH.defaults, filters: { status: [status] } });
