/**
 * The payouts module's part of the Overview (FR-25, D27, D42, docs/operations/dashboard-spec.md
 * Blocks 1 to 4): the cash that moved in a period (network batches paid to the operator, by the
 * day the network paid; payouts to customers, by the day they were recorded), the clawback money
 * netted in a period, and what is owed now, read from `allBalances` (the one payable definition).
 * SQL only SUMs stored integer columns; the composition does the rest through `packages/money`.
 *
 * A netting entry counts as clawback money taken back only while its payout stands: a voided
 * payout gives its netting back (D41).
 */
import type { InstantRange } from "@cashback/core";
import { sumDong } from "@cashback/money";
import { and, eq, gte, isNotNull, lt, ne, sql } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import type { Balance } from "./balance.query";
import { ledgerEntries, networkSettlements, payouts } from "./schema";

export interface NettingFact {
  readonly amount: number;
  readonly createdAt: string;
}

/** Netting entries written in the range by payouts that still stand. */
export function nettingFacts(db: LedgerDb, range: InstantRange): NettingFact[] {
  return db
    .select({ amount: ledgerEntries.amount, createdAt: ledgerEntries.createdAt })
    .from(ledgerEntries)
    .innerJoin(payouts, eq(payouts.payoutId, ledgerEntries.payoutId))
    .where(and(eq(ledgerEntries.kind, "NETTING"), eq(payouts.status, "RECORDED"), gte(ledgerEntries.createdAt, range.from), lt(ledgerEntries.createdAt, range.to)))
    .orderBy(ledgerEntries.entryId)
    .all();
}

export interface PayoutCash {
  readonly count: number;
  readonly amount: number;
}

/** Where a payout or a batch came from: imported at cutover, or recorded by this system. */
export type CashOrigin = "CUTOVER" | "NEW";

/** Transfers recorded in the range that still stand (a voided payout sent nothing); `origin` CUTOVER: only imported payouts. */
export function payoutsSent(db: LedgerDb, range: InstantRange, origin?: CashOrigin): PayoutCash {
  const from = origin === undefined ? undefined : origin === "CUTOVER" ? eq(payouts.origin, "CUTOVER") : ne(payouts.origin, "CUTOVER");
  const row = db
    .select({ count: sql<number>`count(*)`, amount: sql<number>`coalesce(sum(${payouts.transferAmount}), 0)` })
    .from(payouts)
    .where(and(eq(payouts.status, "RECORDED"), gte(payouts.recordedAt, range.from), lt(payouts.recordedAt, range.to), from))
    .get();
  return { count: row?.count ?? 0, amount: row?.amount ?? 0 };
}

export interface NetworkCash {
  readonly batches: number;
  /** What reached the operator's account. */
  readonly received: number;
  /** The batches' gross commission, fee and tax, where the network stated the gross. */
  readonly gross: number;
  readonly fee: number;
  readonly tax: number;
}

/** Network batches paid in the range (by the network's payment time); `origin` CUTOVER: only batches imported at cutover. */
export function networkCash(db: LedgerDb, range: InstantRange, origin?: CashOrigin): NetworkCash {
  const from = origin === undefined ? undefined : origin === "CUTOVER" ? eq(networkSettlements.origin, "CUTOVER") : ne(networkSettlements.origin, "CUTOVER");
  const row = db
    .select({
      batches: sql<number>`count(*)`,
      received: sql<number>`coalesce(sum(${networkSettlements.amount}), 0)`,
      gross: sql<number>`coalesce(sum(${networkSettlements.eligibleAmount}), 0)`,
      fee: sql<number>`coalesce(sum(${networkSettlements.fee}), 0)`,
      tax: sql<number>`coalesce(sum(${networkSettlements.tax}), 0)`,
    })
    .from(networkSettlements)
    .where(and(eq(networkSettlements.status, "PAID"), isNotNull(networkSettlements.paidAt), gte(networkSettlements.paidAt, range.from), lt(networkSettlements.paidAt, range.to), from))
    .get();
  return { batches: row?.batches ?? 0, received: row?.received ?? 0, gross: row?.gross ?? 0, fee: row?.fee ?? 0, tax: row?.tax ?? 0 };
}

export interface ProcessingBatches {
  readonly batches: number;
  /** The gross commission the network stated for them. */
  readonly gross: number;
  /** What the network says it will pay for them. */
  readonly received: number;
}

/** Network batches the network created but has not paid yet (status PROCESSING): money on its way. */
export function networkProcessing(db: LedgerDb): ProcessingBatches {
  const row = db
    .select({ batches: sql<number>`count(*)`, gross: sql<number>`coalesce(sum(${networkSettlements.eligibleAmount}), 0)`, received: sql<number>`coalesce(sum(${networkSettlements.amount}), 0)` })
    .from(networkSettlements)
    .where(eq(networkSettlements.status, "PROCESSING"))
    .get();
  return { batches: row?.batches ?? 0, gross: row?.gross ?? 0, received: row?.received ?? 0 };
}

export interface OwedNow {
  /** Customers' payable balances (D27); confirmed bonuses are part of each balance's gross. */
  readonly toCustomers: number;
  /** Customers with something payable. */
  readonly customers: number;
  /** Open clawbacks not yet netted: what customers owe back. */
  readonly fromCustomers: number;
}

/** What is owed now, from the balances the caller read once (`allBalances`). */
export function owedNow(all: ReadonlyMap<string, Balance>): OwedNow {
  const balances = [...all.values()];
  return {
    toCustomers: sumDong(balances.map((b) => b.payable), "payable"),
    customers: balances.filter((b) => b.payable > 0).length,
    fromCustomers: sumDong(balances.map((b) => b.deductedNext), "deductedNext"),
  };
}
