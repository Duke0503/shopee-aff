/**
 * The shadow run's report (D44, Story 2.9): per order the live and the new state and amounts
 * with the reason for each difference, per customer the live payable (named SQL) beside the
 * shadow payable, waiting and paid, and a summary of differences by reason. Paid parity is the
 * cutover import's, unchanged: the shadow run never changes a paid order, so paid matches to the
 * dong exactly when the import does. The report holds no time and no personal data beyond
 * customer ids, and lists everything sorted, so the same inputs give a byte-identical file.
 */
import { differenceDong, estimatedCashback, sumDong, type AffiliateNetwork } from "@cashback/money";

import type { FullPaidParity } from "./import-report";
import { networkOfPlatform } from "./cutover-context";
import { countBy } from "./order-checks";
import { NOT_JUDGED, type ShadowOrder } from "./shadow-evaluate";
import type { ShadowLedger } from "./shadow-ledger";
import { SHADOW_REASONS, type ShadowReason } from "./shadow-reasons";
import { wholeDong } from "./live-values";

export const SHADOW_REPORT_VERSION = 1;

export interface ShadowCustomer {
  customerId: string;
  /** Live payable from LIVE_PAYABLE_SQL; null when a live sum is not whole dong. */
  livePayable: number | null;
  /** max(0, shadow gross payable - would-be clawbacks), as getBalances will compute it (Story 4.1). */
  shadowPayable: number;
  payableDifference: number | null;
  liveWaiting: number;
  shadowWaiting: number;
  waitingDifference: number;
  livePaid: number;
  shadowPaid: number;
  /** Would-be clawbacks after payout, deducted from the next payout. */
  clawbacks: number;
  changedOrders: number;
}

export interface ReasonTotal {
  reason: ShadowReason;
  text: string;
  orders: number;
  payableDifference: number;
  waitingDifference: number;
  clawback: number;
}

export interface ReportInput {
  network: AffiliateNetwork;
  source: string;
  sha256: string | null;
  rows: number;
  skippedLines: number;
  windowFrom: string | null;
  windowTo: string | null;
}

/** An approved unpaid live order owed to an id that is no customer: never in live payable. */
export interface OrphanOwed {
  orderId: string;
  liveCustomerId: string | null;
  /** The customer the import resolves it to (an alias's survivor), or null. */
  importedCustomerId: string | null;
  cashback: number | null;
  bonus: number;
}

export interface ShadowReport {
  version: number;
  inputs: { liveCopy: { file: string; sha256: string }; reports: ReportInput[] };
  paidParity: FullPaidParity;
  summary: {
    orders: number;
    changed: number;
    byReason: ReasonTotal[];
    /** Customers whose live payable is above the shadow payable: what live would have overpaid. */
    overpaid: { customerId: string; amount: number }[];
    importNotes: Record<string, number>;
    /** Orders not judged, by reason (no report for the network, recorded after the window, ...). */
    notJudged: Record<string, number>;
  };
  liveOrphanOwed: OrphanOwed[];
  customers: ShadowCustomer[];
  orders: ShadowOrder[];
}

/** A sum of two signed differences, through the money package. */
const plus = (a: number, b: number): number => differenceDong(a, differenceDong(0, b));
const add = (map: Map<string, number>, key: string, amount: number): void => void map.set(key, sumDong([map.get(key) ?? 0, amount], "total"));

function liveWaitingTotals(ledger: ShadowLedger): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of ledger.liveWaiting) {
    if (row.customer_id === null) continue;
    const estimate = wholeDong(row.estimated_commission, { allowZero: true });
    add(out, row.customer_id, estimatedCashback(estimate, networkOfPlatform(row.platform), false));
  }
  return out;
}

interface ShadowTotals {
  gross: Map<string, number>;
  waiting: Map<string, number>;
  clawbacks: Map<string, number>;
  changed: Map<string, number>;
}

function shadowTotals(orders: readonly ShadowOrder[]): ShadowTotals {
  const t: ShadowTotals = { gross: new Map(), waiting: new Map(), clawbacks: new Map(), changed: new Map() };
  for (const o of orders) {
    if (o.customerId === null || o.guest) continue;
    add(t.gross, o.customerId, o.shadow.payable);
    add(t.waiting, o.customerId, o.shadow.waiting);
    add(t.clawbacks, o.customerId, o.shadow.clawback);
    if (o.changed) add(t.changed, o.customerId, 1);
  }
  return t;
}

export function customerTotals(ledger: ShadowLedger, orders: readonly ShadowOrder[]): ShadowCustomer[] {
  const t = shadowTotals(orders);
  const liveWaiting = liveWaitingTotals(ledger);
  const house = ledger.live.context.houseIds;
  const ids = [...new Set([...ledger.livePayable.keys(), ...liveWaiting.keys(), ...ledger.livePaid.keys(), ...ledger.importedPaid.keys(), ...t.gross.keys(), ...t.waiting.keys()])];
  return ids
    .filter((id) => id !== "" && !house.has(id))
    .sort()
    .map((customerId) => {
      const livePayable = ledger.livePayable.has(customerId) ? (ledger.livePayable.get(customerId) ?? null) : 0;
      const clawbacks = t.clawbacks.get(customerId) ?? 0;
      const shadowPayable = Math.max(0, differenceDong(t.gross.get(customerId) ?? 0, clawbacks));
      const lw = liveWaiting.get(customerId) ?? 0;
      const sw = t.waiting.get(customerId) ?? 0;
      return {
        customerId,
        livePayable,
        shadowPayable,
        payableDifference: livePayable === null ? null : differenceDong(shadowPayable, livePayable),
        liveWaiting: lw,
        shadowWaiting: sw,
        waitingDifference: differenceDong(sw, lw),
        livePaid: ledger.livePaid.get(customerId) ?? 0,
        shadowPaid: ledger.importedPaid.get(customerId) ?? 0,
        clawbacks,
        changedOrders: t.changed.get(customerId) ?? 0,
      };
    })
    .filter(hasFigure);
}

/** A customer with every figure 0 and no changed order says nothing (a live order of a gone customer). */
const hasFigure = (c: ShadowCustomer): boolean =>
  [c.livePayable ?? 1, c.shadowPayable, c.liveWaiting, c.shadowWaiting, c.livePaid, c.shadowPaid, c.clawbacks, c.changedOrders].some((n) => n !== 0);

export function reasonTotals(orders: readonly ShadowOrder[]): ReasonTotal[] {
  const out = new Map<ShadowReason, ReasonTotal>();
  for (const o of orders.filter((x) => x.changed)) {
    const t = out.get(o.reason) ?? { reason: o.reason, text: SHADOW_REASONS[o.reason], orders: 0, payableDifference: 0, waitingDifference: 0, clawback: 0 };
    t.orders += 1;
    t.payableDifference = plus(t.payableDifference, o.payableDifference);
    t.waitingDifference = plus(t.waitingDifference, o.waitingDifference);
    t.clawback = sumDong([t.clawback, o.shadow.clawback], "clawback");
    out.set(o.reason, t);
  }
  const order = Object.keys(SHADOW_REASONS) as ShadowReason[];
  return [...out.values()].sort((a, b) => order.indexOf(a.reason) - order.indexOf(b.reason));
}

function orphansOf(ledger: ShadowLedger): OrphanOwed[] {
  const imported = new Map(ledger.live.orders.map((o) => [o.orderId, o.customerId]));
  return ledger.liveOrphanOwed.map((r) => ({
    orderId: r.order_id,
    liveCustomerId: r.customer_id,
    importedCustomerId: imported.get(r.order_id) ?? null,
    cashback: wholeDong(r.cashback_amount, { allowZero: true }),
    bonus: r.bonus,
  }));
}

export function buildShadowReport(ledger: ShadowLedger, orders: ShadowOrder[], inputs: ShadowReport["inputs"]): ShadowReport {
  const customers = customerTotals(ledger, orders);
  const overpaid = customers
    .filter((c) => c.payableDifference !== null && c.payableDifference < 0)
    .map((c) => ({ customerId: c.customerId, amount: -(c.payableDifference as number) }));
  return {
    version: SHADOW_REPORT_VERSION,
    inputs,
    paidParity: ledger.paidParity,
    summary: {
      orders: orders.length,
      changed: orders.filter((o) => o.changed).length,
      byReason: reasonTotals(orders),
      overpaid,
      importNotes: countBy(ledger.importReport.notes, (n) => n.kind),
      notJudged: countBy(
        orders.filter((o) => o.reason !== "unchanged" && NOT_JUDGED.includes(o.reason)),
        (o) => o.reason,
      ),
    },
    liveOrphanOwed: orphansOf(ledger),
    customers,
    orders,
  };
}
