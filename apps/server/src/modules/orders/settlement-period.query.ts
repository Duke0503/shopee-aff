/**
 * Settlement periods for the Settings screen (FR-13, D54, D59; Story 4.18). The screen lists, per
 * network, the current Vietnam month (where new approvals fall) and every month that has a stored
 * setting, newest first, each with the withholding an approval in it takes now and where that
 * comes from: the owner's mark (the override), the network's latest payout batch (read from what
 * it paid), or the default. An AccessTrade period is always withheld and not editable.
 *
 * The impact of a change is counted, not guessed at. A setting is read only when an order is
 * approved, in the month of that approval (domain/settlement.ts), so a change reaches only the
 * current month: a past month's orders are approved already and keep their stored cashback, and a
 * later month has no approvals yet. Within the current month it reaches the network's orders
 * still waiting for approval that earn cashback (not the guest account, D5), and none when the
 * new setting is the one those approvals would take anyway.
 */
import { NETWORK_MONEY_RULES, type AffiliateNetwork } from "@cashback/money";
import type { Clock } from "@cashback/core";
import { and, count, eq, isNotNull, notInArray } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { guestCustomerIds } from "../identity/index";
import { settlementPeriodOf } from "./domain/settlement";
import { periodWithholding } from "./settlement-period.command";
import { ORDER_NETWORKS, orders, settlementPeriods } from "./schema";

export interface PeriodRow {
  readonly network: AffiliateNetwork;
  readonly periodMonth: string;
  readonly withheld: boolean;
  readonly editable: boolean;
  readonly origin: "DEFAULT" | "CUTOVER" | "STAFF" | "NETWORK";
  /** The batch the setting comes from, for origin NETWORK. */
  readonly basedOn: string | null;
}

/** Every period the screen shows, Shopee first, newest month first within a network. */
export function settlementPeriodRows(db: LedgerDb, clock: Clock): { currentMonth: string; periods: PeriodRow[] } {
  const currentMonth = settlementPeriodOf(clock.now());
  const stored = db.select().from(settlementPeriods).all();
  const periods = ORDER_NETWORKS.flatMap((network) => {
    const marks = new Map(stored.filter((p) => p.network === network).map((p) => [p.periodMonth, p]));
    const months = [...new Set([currentMonth, ...marks.keys()])].sort().reverse();
    return months.map((periodMonth): PeriodRow => {
      const now = periodWithholding(db, network, periodMonth);
      const origin = now.source === "STAFF" || now.source === "NETWORK" ? now.source : (marks.get(periodMonth)?.origin ?? "DEFAULT");
      return { network, periodMonth, withheld: now.withheld, editable: !NETWORK_MONEY_RULES[network].alwaysWithheld, origin, basedOn: now.networkPayoutId };
    });
  });
  return { currentMonth, periods };
}

/** How many orders setting the period to `withheld` would reach. */
export function settlementPeriodImpact(db: LedgerDb, network: AffiliateNetwork, periodMonth: string, withheld: boolean, clock: Clock): number {
  if (NETWORK_MONEY_RULES[network].alwaysWithheld || periodMonth !== settlementPeriodOf(clock.now())) return 0;
  if (periodWithholding(db, network, periodMonth).withheld === withheld) return 0;
  const guests = guestCustomerIds(db);
  const where = and(eq(orders.network, network), eq(orders.status, "AWAITING_APPROVAL"), isNotNull(orders.customerId), guests.length === 0 ? undefined : notInArray(orders.customerId, guests));
  return db.select({ n: count() }).from(orders).where(where).get()?.n ?? 0;
}
