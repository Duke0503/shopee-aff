/**
 * The Overview's money blocks (Story 4.17, docs/operations/dashboard-spec.md Blocks 2, 4 and 6):
 * the business result of a period by approval day, the weekly profit trend and each event's own
 * profit or loss. They read the same stored facts (orders approved, awards holding a slot, netting
 * entries) and add them up only through `packages/money`, so the period figures, the trend and the
 * events agree to the dong.
 *
 *   profit = commission - fee - tax - cashback - event bonus + clawback netted
 *
 * Guest (HOUSE) orders count in commission and profit and never in cashback (D5); an erased
 * customer's later orders carry cashback 0 by construction. An event bonus counts when its award is
 * CONFIRMED or PAID; a HELD award holds a slot but costs nothing yet.
 */
import type { Figure, Overview, OverviewEvent, OverviewWeek, Ratio } from "@cashback/contracts";
import { addVnDays, parseInstant, vnDateOf, vnDateRange, vnWeekStart, type InstantRange, type VnDate } from "@cashback/core";
import { cashProfit, changeOf, eventResult, operatorProfit, operatorShareOf, profitTotal, ratioBps, sumDong, type ProfitInput } from "@cashback/money";

import { campaignNamesOf, campaignsOverlapping, liveAwards, type AwardFact } from "../modules/campaigns/index";
import { approvedFactsOf, approvedOrderFacts, type ApprovedOrderFact } from "../modules/orders/index";
import { nettingFacts, type NettingFact } from "../modules/payouts/index";
import type { LedgerDb } from "../platform/db/ledger";

const SPENT = new Set<AwardFact["status"]>(["CONFIRMED", "PAID"]);

export interface PeriodFacts {
  readonly orders: readonly ApprovedOrderFact[];
  /** Spent bonuses (CONFIRMED, PAID) on those orders. */
  readonly bonuses: readonly AwardFact[];
  readonly netting: readonly NettingFact[];
}

/** The stored facts behind a period's business result; `guests` are the HOUSE ids, whose cashback is 0. */
export function periodFacts(db: LedgerDb, range: InstantRange, guests: ReadonlySet<string>, awards: readonly AwardFact[]): PeriodFacts {
  const orders = approvedOrderFacts(db, range).map((o) => (o.customerId !== null && guests.has(o.customerId) ? { ...o, cashback: 0 } : o));
  const ids = new Set(orders.map((o) => o.orderId));
  return { orders, bonuses: awards.filter((a) => SPENT.has(a.status) && ids.has(a.orderId)), netting: nettingFacts(db, range) };
}

/** The profit inputs of a set of facts. */
export function profitInputOf(f: PeriodFacts): ProfitInput {
  return {
    commission: sumDong(f.orders.map((o) => o.approvedCommission), "commission"),
    fee: sumDong(f.orders.map((o) => o.fee ?? 0), "fee"),
    tax: sumDong(f.orders.map((o) => o.tax ?? 0), "tax"),
    cashback: sumDong(f.orders.map((o) => o.cashback), "cashback"),
    eventBonus: sumDong(f.bonuses.map((b) => b.amount), "eventBonus"),
    clawbackNetted: sumDong(f.netting.map((n) => n.amount), "clawbackNetted"),
  };
}

const hasData = (f: PeriodFacts): boolean => f.orders.length > 0 || f.netting.length > 0;
const figure = (now: PeriodFacts, before: PeriodFacts, pick: (p: ProfitInput & { profit: number; orders: number }) => number): Figure => {
  const of = (f: PeriodFacts) => {
    if (!hasData(f)) return null;
    const p = profitInputOf(f);
    return pick({ ...p, profit: operatorProfit(p), orders: f.orders.length });
  };
  return figureOf(of(now), of(before));
};

/** A figure with its change from the previous period (`packages/money`). */
export const figureOf = (value: number | null, previous: number | null): Figure => ({ value, previous, change: changeOf(value, previous) });

function byNetwork(f: PeriodFacts): Overview["business"]["byNetwork"] {
  return (["shopee", "accesstrade"] as const).flatMap((network) => {
    const orders = f.orders.filter((o) => o.network === network);
    return orders.length === 0 ? [] : [{ network, commission: sumDong(orders.map((o) => o.approvedCommission), "commission"), orders: orders.length }];
  });
}

function byCampaign(db: LedgerDb, f: PeriodFacts): Overview["business"]["byCampaign"] {
  const ids = [...new Set(f.bonuses.map((b) => b.campaignId))].sort();
  const names = campaignNamesOf(db, ids);
  return ids.map((campaignId) => ({ campaignId, name: names.get(campaignId) ?? campaignId, bonus: sumDong(f.bonuses.filter((b) => b.campaignId === campaignId).map((b) => b.amount), "bonus") }));
}

/** The parts of the money of a period as shares of the whole; null when there is nothing or a loss. */
function splitOf(f: PeriodFacts): Overview["business"]["split"] {
  if (!hasData(f)) return null;
  const p = profitInputOf(f);
  const profit = operatorProfit(p);
  const feeAndTax = sumDong([p.fee, p.tax], "feeAndTax");
  const whole = sumDong([p.commission, p.clawbackNetted], "whole");
  if (profit < 0 || whole === 0) return null;
  const share = (part: number): number => ratioBps(part, whole) ?? 0;
  return { feeAndTax, feeAndTaxBps: share(feeAndTax), cashbackBps: share(p.cashback), eventBonusBps: share(p.eventBonus), profitBps: share(profit) };
}

/** The cash that moved for orders imported at cutover in a period; null when none did (owner decision 2026-10-31). */
export interface CashPart {
  readonly received: number;
  readonly paidOut: number;
}

function cashBasisOf(now: CashPart | null, before: CashPart | null): Overview["business"]["cashBasis"] {
  if (now === null) return null;
  return { received: now.received, paidOut: now.paidOut, profit: cashProfit(now.received, now.paidOut), previousProfit: before === null ? null : cashProfit(before.received, before.paidOut) };
}

/** Block 2: the business result of the period, each figure with the previous period's. */
export function businessOf(db: LedgerDb, now: PeriodFacts, before: PeriodFacts, extra: Pick<Overview["business"], "importedWithoutApproval"> & { readonly cash: { readonly now: CashPart | null; readonly before: CashPart | null } }): Overview["business"] {
  const profit = figure(now, before, (p) => p.profit);
  const cashBasis = cashBasisOf(extra.cash.now, extra.cash.before);
  const cashBefore = extra.cash.before;
  const totalProfit = figureOf(profitTotal([profit.value, cashBasis?.profit ?? null]), profitTotal([profit.previous, cashBefore === null ? null : cashProfit(cashBefore.received, cashBefore.paidOut)]));
  const commission = figure(now, before, (p) => p.commission);
  const marginOf = (p: number | null, c: number | null) => (p === null || c === null ? null : ratioBps(p, c));
  return {
    commission,
    approvedOrders: figure(now, before, (p) => p.orders),
    byNetwork: byNetwork(now),
    fee: figure(now, before, (p) => p.fee),
    tax: figure(now, before, (p) => p.tax),
    withheldPeriods: [...new Set(now.orders.flatMap((o) => (o.withheldPeriod === null ? [] : [o.withheldPeriod])))].sort(),
    cashback: figure(now, before, (p) => p.cashback),
    cashbackPaid: sumDong(now.orders.filter((o) => o.status === "PAID").map((o) => o.cashback), "cashbackPaid"),
    cashbackOwed: sumDong(now.orders.filter((o) => o.status === "APPROVED").map((o) => o.cashback), "cashbackOwed"),
    eventBonus: figure(now, before, (p) => p.eventBonus),
    byCampaign: byCampaign(db, now),
    clawbackNetted: figure(now, before, (p) => p.clawbackNetted),
    profit,
    cashBasis,
    totalProfit,
    split: splitOf(now),
    margin: ratioOf(marginOf(profit.value, commission.value), marginOf(profit.previous, commission.previous), true),
    withoutSplit: now.orders.filter((o) => o.fee === null || o.tax === null).length,
    importedWithoutApproval: extra.importedWithoutApproval,
  };
}

/** A ratio with its change in basis points. */
export const ratioOf = (bps: number | null, previousBps: number | null, enoughData: boolean): Ratio => ({ bps, previousBps, changeBps: changeOf(bps, previousBps), enoughData });

export const TREND_WEEKS = 12;

/** Block 4: the last 12 Vietnam weeks (this one included) of profit, commission and cashback, with the 12 before as the comparison. */
export function trendOf(db: LedgerDb, today: VnDate, guests: ReadonlySet<string>, awards: readonly AwardFact[]): Overview["trend"] {
  const thisWeek = vnWeekStart(today);
  const first = addVnDays(thisWeek, -7 * (2 * TREND_WEEKS - 1));
  const all = periodFacts(db, vnDateRange(first, addVnDays(thisWeek, 6)), guests, awards);
  const weekOf = (at: string): VnDate => vnWeekStart(vnDateOf(parseInstant(at)));
  const slice = (from: VnDate, to: VnDate): PeriodFacts => {
    const inside = (at: string) => weekOf(at) >= from && weekOf(at) <= to;
    const orders = all.orders.filter((o) => inside(o.approvedAt));
    const ids = new Set(orders.map((o) => o.orderId));
    return { orders, bonuses: all.bonuses.filter((b) => ids.has(b.orderId)), netting: all.netting.filter((n) => inside(n.createdAt)) };
  };
  const weeks: OverviewWeek[] = [];
  for (let i = TREND_WEEKS - 1; i >= 0; i--) {
    const weekStart = addVnDays(thisWeek, -7 * i);
    const p = profitInputOf(slice(weekStart, weekStart));
    weeks.push({ weekStart, profit: operatorProfit(p), commission: p.commission, cashback: p.cashback });
  }
  const recent = slice(addVnDays(thisWeek, -7 * (TREND_WEEKS - 1)), thisWeek);
  const older = slice(first, addVnDays(thisWeek, -7 * TREND_WEEKS));
  return { weeks, totals: { profit: figure(recent, older, (p) => p.profit), commission: figure(recent, older, (p) => p.commission), cashback: figure(recent, older, (p) => p.cashback) } };
}

/** Block 6: one row per campaign whose window overlaps the period, with its own profit or loss. */
export function eventsOf(db: LedgerDb, range: InstantRange, guests: ReadonlySet<string>): OverviewEvent[] {
  const windows = campaignsOverlapping(db, range);
  const awards = liveAwards(db, windows.map((c) => c.campaignId));
  return windows.map((c) => {
    const own = awards.filter((a) => a.campaignId === c.campaignId);
    const orders = approvedFactsOf(db, [...new Set(own.map((a) => a.orderId))]).map((o) => (o.customerId !== null && guests.has(o.customerId) ? { ...o, cashback: 0 } : o));
    const p = profitInputOf({ orders, bonuses: [], netting: [] });
    const bonus = sumDong(own.filter((a) => SPENT.has(a.status)).map((a) => a.amount), "bonus");
    const operatorShare = operatorShareOf(p);
    return { campaignId: c.campaignId, name: c.name, startsAt: c.startsAt, endsAt: c.endsAt, slotsUsed: own.length, slots: c.slots, bonus, commission: p.commission, operatorShare, result: eventResult(operatorShare, bonus) };
  });
}
