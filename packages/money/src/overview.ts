/**
 * The Overview's money (FR-25, FR-27, AD-5, docs/operations/dashboard-spec.md): the operator's
 * profit for a period, its margin and the other ratios, and the balance of two customers read as
 * one (a merge, FR-11). SQL only sums stored integers; every other step is here.
 *
 *   profit = commission - fee - tax - cashback - eventBonus + clawbackNetted   (may be negative)
 *   margin = profit / commission
 *   event  = operatorShare - bonus, operatorShare = commission - fee - tax - cashback
 *
 * A ratio is integer basis points (1 bps = 0.01%), rounded half-up once; a ratio over a 0
 * denominator is null (nothing to measure), never 0. A change between two periods is the signed
 * difference in dong, or in basis points for a ratio.
 */
import { payableBalance } from "./balance";
import { sumDong } from "./clawback";
import { assertDong, assertNonNegativeDong, roundHalfUp } from "./rounding";

export interface ProfitInput {
  /** Approved commission of the period's approved orders, guests included. */
  readonly commission: number;
  /** The network fee stored on those orders. */
  readonly fee: number;
  /** The withheld tax stored on those orders. */
  readonly tax: number;
  /** The cashback stored on those orders (0 for guests). */
  readonly cashback: number;
  /** Confirmed and paid campaign bonuses on those orders. */
  readonly eventBonus: number;
  /** Clawback entries netted in the period: money taken back from customers. */
  readonly clawbackNetted: number;
}

/** The operator's profit; negative when bonuses and cashback exceed what the networks gave. */
export function operatorProfit(input: ProfitInput): number {
  const income = sumDong([input.commission, input.clawbackNetted], "income");
  const cost = sumDong([input.fee, input.tax, input.cashback, input.eventBonus], "cost");
  return assertDong(income - cost, "profit");
}

/** What the operator keeps from orders before any event bonus: commission - fee - tax - cashback. */
export function operatorShareOf(input: Pick<ProfitInput, "commission" | "fee" | "tax" | "cashback">): number {
  return assertDong(assertNonNegativeDong(input.commission, "commission") - sumDong([input.fee, input.tax, input.cashback], "cost"), "operatorShare");
}

/** An event's own profit or loss: the operator's share of its award orders minus the bonuses paid. */
export function eventResult(operatorShare: number, bonus: number): number {
  return assertDong(assertDong(operatorShare, "operatorShare") - assertNonNegativeDong(bonus, "bonus"), "eventResult");
}

const BPS = 10_000n;

/** `numerator / denominator` in basis points, half-up; null when the denominator is 0. The numerator may be negative (a loss margin). */
export function ratioBps(numerator: number, denominator: number): number | null {
  assertDong(numerator, "numerator");
  if (assertNonNegativeDong(denominator, "denominator") === 0) return null;
  return roundHalfUp(BigInt(numerator) * BPS, BigInt(denominator));
}

/** An average in whole dong (commission per order), half-up; null over 0 items. */
export function averageDong(total: number, count: number): number | null {
  assertNonNegativeDong(total, "total");
  if (assertNonNegativeDong(count, "count") === 0) return null;
  return roundHalfUp(BigInt(total), BigInt(count));
}

/** The signed change from the previous period; null when either side has no value. */
export function changeOf(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return assertDong(assertDong(current, "current") - assertDong(previous, "previous"), "change");
}

/**
 * Several signed profits read as one (the approval-basis part and the cash-basis part of a period,
 * owner decision 2026-10-31); a part with no value is left out, and nothing at all is null.
 */
export function profitTotal(parts: readonly (number | null)[]): number | null {
  const present = parts.filter((p): p is number => p !== null);
  if (present.length === 0) return null;
  return assertDong(present.reduce((sum, p) => assertDong(sum + assertDong(p, "profit"), "profit"), 0), "profit");
}

/** The cash-basis profit of a period: what the networks paid minus what was transferred to customers. */
export function cashProfit(received: number, paidOut: number): number {
  return assertDong(assertNonNegativeDong(received, "received") - assertNonNegativeDong(paidOut, "paidOut"), "cashProfit");
}

export interface BalanceParts {
  readonly gross: number;
  readonly deductedNext: number;
  readonly waiting: number;
  readonly paid: number;
}

/** Several balances read as one customer's (a merge, D42): parts add up, payable is recomputed from them. */
export function combinedBalance(parts: readonly BalanceParts[]): BalanceParts & { readonly payable: number } {
  const gross = sumDong(parts.map((p) => p.gross), "gross");
  const deductedNext = sumDong(parts.map((p) => p.deductedNext), "deductedNext");
  return { gross, deductedNext, payable: payableBalance({ gross, openClawbacks: deductedNext }), waiting: sumDong(parts.map((p) => p.waiting), "waiting"), paid: sumDong(parts.map((p) => p.paid), "paid") };
}
