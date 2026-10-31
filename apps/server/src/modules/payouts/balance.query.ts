/**
 * `getBalances` (AD-6, D11, D27, D42, FR-15, FR-16, FR-38): the one definition of what a customer
 * is owed. Every screen, chat reply, QR amount and export reads it, so they cannot disagree.
 *
 *   gross        = stored cashback of APPROVED unpaid orders + CONFIRMED bonuses (not on a FROZEN order)
 *                  + credits a payout void left (netting already taken by a clawback it closed)
 *   deductedNext = the open clawbacks, each the sum of its insert-only entries
 *   payable      = max(0, gross - deductedNext)
 *   waiting      = the estimated cashback of AWAITING_APPROVAL orders
 *   paid         = the transfers of RECORDED payouts
 *
 * Each record is credited to the survivor its stored customer id resolves to (`resolveCustomer`),
 * because a merge moves no row; the payable list reads every table once with grouped SUMs and
 * resolves each stored id once. FROZEN and REVERSED orders count nowhere. The guest
 * account (HOUSE) has no balance and is in no payable list (D5). SQL only SUMs stored integers;
 * every other step is `packages/money`.
 */
import { clawbackOpenAmount, creditOpenAmount, estimatedCashback, openClawbackTotal, payableBalance, sumDong } from "@cashback/money";
import { and, eq, inArray, notInArray, sql, type SQL } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { confirmedBonusByCustomer } from "../campaigns/index";
import { customerKeys, ledgerOwnerOf } from "../identity/index";
import { orderBalanceRows } from "../orders/index";
import { CREDIT_KINDS, ledgerEntries, payouts } from "./schema";

export interface Balance {
  /** The surviving customer id. */
  readonly customerId: string;
  /** Approved unpaid cashback plus confirmed bonuses, before clawbacks. */
  readonly gross: number;
  readonly payable: number;
  readonly waiting: number;
  readonly paid: number;
  /** Open clawbacks, positive, deducted at the next payout (the balance card's own line). */
  readonly deductedNext: number;
}

interface Parts {
  readonly gross: number[];
  readonly waiting: number[];
  readonly paid: number[];
  /** Each clawback's entry sums, by clawback id. */
  readonly clawbacks: Map<string, number[]>;
  /** Each void credit's entry sums, by clawback id. */
  readonly credits: Map<string, number[]>;
}

const within = (column: typeof payouts.customerId | typeof ledgerEntries.customerId, ids: readonly string[] | null): SQL | undefined => (ids === null ? undefined : inArray(column, [...ids]));

function paidRows(db: LedgerDb, ids: readonly string[] | null) {
  return db
    .select({ customerId: payouts.customerId, total: sql<number>`coalesce(sum(${payouts.transferAmount}), 0)` })
    .from(payouts)
    .where(and(eq(payouts.status, "RECORDED"), within(payouts.customerId, ids)))
    .groupBy(payouts.customerId)
    .all();
}

function ledgerRows(db: LedgerDb, ids: readonly string[] | null, credits: boolean) {
  const kinds = credits ? inArray(ledgerEntries.kind, [...CREDIT_KINDS]) : notInArray(ledgerEntries.kind, [...CREDIT_KINDS]);
  return db
    .select({ customerId: ledgerEntries.customerId, clawbackId: ledgerEntries.clawbackId, total: sql<number>`sum(${ledgerEntries.amount})` })
    .from(ledgerEntries)
    .where(and(kinds, within(ledgerEntries.customerId, ids)))
    .groupBy(ledgerEntries.customerId, ledgerEntries.clawbackId)
    .all();
}

function addEntry(into: Map<string, number[]>, clawbackId: string, total: number): void {
  const entries = into.get(clawbackId);
  if (entries === undefined) into.set(clawbackId, [total]);
  else entries.push(total);
}

export type Owner = (stored: string) => string | null;

/** A balance of nothing at all: every figure 0. */
export const NO_BALANCE: Omit<Balance, "customerId"> = { gross: 0, payable: 0, waiting: 0, paid: 0, deductedNext: 0 };

/**
 * The survivor a stored customer id belongs to, resolved once per id; null for nobody or HOUSE (D5).
 * An erased record keeps its money facts (FR-35, D26): what it is still owed stays its own balance.
 */
export function survivorResolver(db: LedgerDb): Owner {
  const known = new Map<string, string | null>();
  return (stored) => {
    if (!known.has(stored)) {
      const found = ledgerOwnerOf(db, stored);
      known.set(stored, found === null || found.role === "HOUSE" ? null : found.customerId);
    }
    return known.get(stored) ?? null;
  };
}

/** Every balance part over the stored ids (null: all), credited to survivors; `seed` survivors start at 0. */
function collect(db: LedgerDb, ids: readonly string[] | null, seed: readonly string[], owner: Owner = survivorResolver(db)): Map<string, Parts> {
  const empty = (): Parts => ({ gross: [], waiting: [], paid: [], clawbacks: new Map(), credits: new Map() });
  const parts = new Map<string, Parts>(seed.map((id) => [id, empty()]));
  const of = (stored: string): Parts | undefined => {
    const id = owner(stored);
    if (id === null) return undefined;
    if (!parts.has(id)) parts.set(id, empty());
    return parts.get(id);
  };
  const orders = orderBalanceRows(db, ids);
  for (const r of orders.approvedUnpaid) of(r.customerId)?.gross.push(r.total);
  for (const r of confirmedBonusByCustomer(db, ids, orders.frozenOrderIds)) of(r.customerId)?.gross.push(r.total);
  for (const r of orders.awaiting) of(r.customerId)?.waiting.push(estimatedCashback(r.estimatedCommission, r.network));
  for (const r of paidRows(db, ids)) of(r.customerId)?.paid.push(r.total);
  for (const r of ledgerRows(db, ids, false)) {
    const p = of(r.customerId);
    if (p !== undefined) addEntry(p.clawbacks, r.clawbackId, r.total);
  }
  for (const r of ledgerRows(db, ids, true)) {
    const p = of(r.customerId);
    if (p !== undefined) addEntry(p.credits, r.clawbackId, r.total);
  }
  return parts;
}

function balanceOf(customerId: string, p: Parts): Balance {
  const gross = sumDong([...p.gross, ...[...p.credits.values()].map(creditOpenAmount)], "gross");
  const deductedNext = openClawbackTotal([...p.clawbacks.values()].map(clawbackOpenAmount));
  return { customerId, gross, payable: payableBalance({ gross, openClawbacks: deductedNext }), waiting: sumDong(p.waiting, "waiting"), paid: sumDong(p.paid, "paid"), deductedNext };
}

/**
 * The balance of each customer named (by id, code or alias), once per survivor, in the order asked.
 * A key that resolves to nobody or to the guest account returns no balance; an erased record keeps its own (FR-35).
 */
export function getBalances(db: LedgerDb, customerIds: readonly string[]): Balance[] {
  const asked: string[] = [];
  const keys = new Set<string>();
  for (const id of customerIds) {
    const found = customerKeys(db, id, { erased: true });
    if (found === null || found.customer.role === "HOUSE" || asked.includes(found.customer.customerId)) continue;
    asked.push(found.customer.customerId);
    for (const key of found.keys) keys.add(key);
  }
  if (asked.length === 0) return [];
  const parts = collect(db, [...keys], asked);
  return asked.map((id) => balanceOf(id, parts.get(id) as Parts));
}

/**
 * The balance of every survivor any record is credited to, by survivor id, read in one pass with
 * the same parts and the same arithmetic as `getBalances`: the Customers list shows exactly the
 * figures of the customer page and the Payouts row. A customer absent from the map has nothing
 * anywhere (`NO_BALANCE`). A caller that also credits other records may pass its own `owner`, so
 * one request resolves each stored id once.
 */
export function allBalances(db: LedgerDb, owner?: Owner): Map<string, Balance> {
  return new Map([...collect(db, null, [], owner)].map(([id, p]) => [id, balanceOf(id, p)]));
}

/**
 * Every customer with something to pay or to net (gross above 0), by survivor id. One whose open
 * clawbacks reach the gross stays in the list with payable 0: a netting-only payout clears it (D42).
 */
export function payableBalances(db: LedgerDb, all: ReadonlyMap<string, Balance> = allBalances(db)): Balance[] {
  return [...all.values()]
    .filter((b) => b.gross > 0)
    .sort((a, b) => (a.customerId < b.customerId ? -1 : a.customerId > b.customerId ? 1 : 0));
}
