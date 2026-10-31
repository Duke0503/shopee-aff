/**
 * The Overview's one query layer (FR-25, FR-27, FR-38, AD-5, AD-27, Story 4.17,
 * docs/operations/dashboard-spec.md): every figure of the landing screen, for one period, read in
 * one pass over the ledger. The Overview meets six modules, so it is composed here like the desk
 * itself; each module answers for its own tables, `getBalances` (through the Payouts queue and
 * `allBalances`) is the only payable definition, and every sum and ratio is `packages/money`.
 *
 * Periods and days are Vietnam days (D28): "today" at 06:30 in Vietnam is that Vietnam day, never
 * the UTC one. Figures with nothing behind them are null, never 0 (LC-9, LC-15).
 */
import type { Overview, OverviewQuery } from "@cashback/contracts";
import { addVnDays, overviewPeriod, vnDateRange, vnToday, type Clock, type InstantRange, type OverviewPeriod, type VnDays } from "@cashback/core";
import { differenceDong, estimatedCashback, sumDong } from "@cashback/money";

import { liveAwards } from "../modules/campaigns/index";
import { earnsNothing, guestCustomerIds, ledgerOwnerOf, type LedgerOwner } from "../modules/identity/index";
import { failedLinkCount } from "../modules/linking/index";
import { awaitingOrderFacts, importedWithoutApproval, openReviewCaseCount, orderAging, unsettledApprovedCommission } from "../modules/orders/index";
import { allBalances, networkCash, networkProcessing, owedNow, payoutQueueRows, payoutsSent, type Balance } from "../modules/payouts/index";
import type { LedgerDb } from "../platform/db/ledger";
import { customersOf, healthOf, ordersOf } from "./overview-activity.query";
import { businessOf, eventsOf, figureOf, periodFacts, trendOf, type CashPart } from "./overview-business.query";

/** The window the advance warning compares money in and out over. */
export const ADVANCE_WINDOW_DAYS = 60;

const rangeOf = (days: VnDays): InstantRange => vnDateRange(days.from, days.to);

/** Block 1: what needs the operator now, with the Payouts queue's own rows (the same payable definition). */
function todoOf(db: LedgerDb, clock: Clock, balances: ReadonlyMap<string, Balance>): Overview["todo"] {
  const rows = payoutQueueRows(db, clock, balances).filter((r) => r.payable > 0);
  const payable = rows.filter((r) => r.queue === "PAYABLE");
  const noBank = rows.filter((r) => r.flags.split(",").some((f) => f === "NO_BANK" || f === "BANK_HELD"));
  const today = vnToday(clock);
  return {
    payable: { customers: payable.length, amount: sumDong(payable.map((r) => r.payable), "payable") },
    openReviewCases: openReviewCaseCount(db),
    failedLinksToday: failedLinkCount(db, vnDateRange(today, today)),
    owedWithoutBank: { customers: noBank.length, amount: sumDong(noBank.map((r) => r.payable), "payable") },
  };
}

/**
 * The estimate of what awaiting orders will bring, labelled as an estimate. Who earns nothing is the
 * one rule (`earnsNothing`): the guest, and an erased record for orders recorded after its erasure;
 * an order of nobody earns nothing. Each stored owner id is resolved once.
 */
function awaitingOf(db: LedgerDb): Overview["money"]["awaiting"] {
  const orders = awaitingOrderFacts(db);
  const owners = new Map<string, LedgerOwner | null>();
  const ownerOf = (id: string): LedgerOwner | null => {
    if (!owners.has(id)) owners.set(id, ledgerOwnerOf(db, id));
    return owners.get(id) ?? null;
  };
  const nothing = (id: string | null, recordedAt: string | null): boolean => {
    const owner = id === null ? null : ownerOf(id);
    // A stored order without a recorded time came from the cutover, before any erasure.
    return owner === null || earnsNothing(owner, recordedAt ?? "");
  };
  return {
    orders: orders.length,
    commission: sumDong(orders.map((o) => o.estimatedCommission ?? 0), "estimate"),
    cashback: sumDong(orders.map((o) => estimatedCashback(o.estimatedCommission, o.network, nothing(o.customerId, o.recordedAt))), "estimatedCashback"),
  };
}

/** The cash that moved for the cutover's imported orders in a range, or null when none did (owner decision 2026-10-31). */
function cashPartOf(db: LedgerDb, range: InstantRange): CashPart | null {
  const received = networkCash(db, range, "CUTOVER").received;
  const paidOut = payoutsSent(db, range, "CUTOVER").amount;
  return received === 0 && paidOut === 0 && importedWithoutApproval(db, range) === 0 ? null : { received, paidOut };
}

function cashOf(db: LedgerDb, range: InstantRange, previous: InstantRange): Overview["money"]["cash"] {
  const now = networkCash(db, range);
  const before = networkCash(db, previous);
  const sent = payoutsSent(db, range);
  const sentBefore = payoutsSent(db, previous);
  return {
    networkBatches: now.batches,
    networkGross: figureOf(now.batches === 0 ? null : now.gross, before.batches === 0 ? null : before.gross),
    networkFee: now.fee,
    networkTax: now.tax,
    received: figureOf(now.received, before.received),
    paidOut: figureOf(sent.amount, sentBefore.amount),
    payouts: sent.count,
    difference: figureOf(differenceDong(now.received, sent.amount), differenceDong(before.received, sentBefore.amount)),
  };
}

/** Block 3: the money position now, and the cash that moved in the period. */
function moneyOf(db: LedgerDb, clock: Clock, range: InstantRange, previous: InstantRange, balances: ReadonlyMap<string, Balance>): Overview["money"] {
  const owed = owedNow(balances);
  const today = vnToday(clock);
  const window = vnDateRange(addVnDays(today, -(ADVANCE_WINDOW_DAYS - 1)), today);
  const received = networkCash(db, window).received;
  const paidOut = payoutsSent(db, window).amount;
  return {
    networksOwe: unsettledApprovedCommission(db),
    weOweCustomers: owed.toCustomers,
    customersOweUs: owed.fromCustomers,
    awaiting: awaitingOf(db),
    cash: cashOf(db, range, previous),
    processing: networkProcessing(db),
    advanceWarning: owed.toCustomers > differenceDong(received, paidOut),
    last60Days: { received, paidOut },
  };
}

/** The period a query names; a custom period outside the rules throws a RangeError (checked before any read). */
export function periodOf(query: OverviewQuery, clock: Clock): OverviewPeriod {
  return overviewPeriod(query.period, clock, query.from !== undefined && query.to !== undefined ? { from: query.from, to: query.to } : undefined);
}

/**
 * Every figure of the Overview for one period. Call it inside one read transaction (overview.routes.ts)
 * so every block reads the same snapshot; the balances are read once and shared by the blocks.
 */
export function overviewOf(db: LedgerDb, query: OverviewQuery, clock: Clock): Overview {
  const period = periodOf(query, clock);
  const range = rangeOf(period);
  const previous = rangeOf(period.previous);
  const guests = new Set(guestCustomerIds(db));
  const awards = liveAwards(db, null);
  const now = periodFacts(db, range, guests, awards);
  const before = periodFacts(db, previous, guests, awards);
  const orders = ordersOf(db, range, previous);
  const approvedRecorded = orders.find((o) => o.network === "all")?.approved ?? 0;
  const balances = allBalances(db);
  return {
    asOf: clock.now(),
    period: { preset: period.preset, from: period.from, to: period.to, previousFrom: period.previous.from, previousTo: period.previous.to },
    todo: todoOf(db, clock, balances),
    business: businessOf(db, now, before, { importedWithoutApproval: importedWithoutApproval(db, range), cash: { now: cashPartOf(db, range), before: cashPartOf(db, previous) } }),
    money: moneyOf(db, clock, range, previous, balances),
    trend: trendOf(db, vnToday(clock), guests, awards),
    orders: { networks: orders, aged: orderAging(db, clock.now()).aged },
    events: eventsOf(db, range, guests),
    customers: customersOf(db, range, previous, now.orders, approvedRecorded),
    health: healthOf(db, clock),
  };
}
