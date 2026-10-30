/**
 * What one payout would cover right now (AD-6, AD-9, D19, D27, INV-3, INV-4): the payable orders
 * and confirmed bonuses one by one, the open clawbacks it nets, the amount, the bank account and
 * the hold, and the hash of all of it. The amount is `getBalances` payable, the one definition,
 * and the lines are read under the same conditions as its sums; if they ever disagreed the
 * snapshot throws instead of showing a QR for a figure nobody can explain. The browser sends no
 * amount and no order list: everything here is the server's (INV-4).
 *
 * The hash covers exactly what confirm re-checks (Story 4.8): customer, order ids with their
 * stored cashback, award ids with their amounts, clawback ids with their open amounts, the void
 * credits it pays back (Story 4.10), the
 * amount, and, when money moves, the bank account as a whole: its fingerprint, the hold flag, the
 * bank as written (folded), the VietQR BIN it matches and the holder. A change to any of them is a
 * new claim. A netting-only snapshot (amount 0) pays into no account, so a bank edit leaves its
 * hash, and the confirm, alone.
 */
import { createHash } from "node:crypto";
import { clawbackOpenAmount, creditOpenAmount, nettingPlan, openClawbackTotal, sumDong, type NettingPlan } from "@cashback/money";
import { and, inArray, sql } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { confirmedBonusLines, type BonusLine } from "../campaigns/index";
import { bankAccountsOf, customerCardOf, customerKeys, plainBankText, type BankAccountFacts } from "../identity/index";
import { orderBalanceRows, payableOrderLines, type PayableOrderLine } from "../orders/index";
import { getBalances, type Balance } from "./balance.query";
import { CLAWBACK_KINDS, CREDIT_KINDS, ledgerEntries, type LEDGER_ENTRY_KINDS } from "./schema";

export interface ClawbackLine {
  readonly clawbackId: string;
  /** The customer id the clawback's original entry is stored under (an alias resolves to the survivor). */
  readonly customerId: string;
  readonly orderId: string | null;
  /** Still owed back, positive. */
  readonly open: number;
}

/** A credit a payout void left (netting a clawback already took), paid with this payout. */
export interface RefundLine {
  readonly clawbackId: string;
  readonly customerId: string;
  readonly orderId: string | null;
  /** Still owed to the customer, positive. */
  readonly amount: number;
}

export interface PayoutSnapshot {
  readonly customerId: string;
  readonly customerCode: string | null;
  readonly customerName: string | null;
  readonly balance: Balance;
  readonly orders: readonly PayableOrderLine[];
  readonly bonuses: readonly BonusLine[];
  readonly clawbacks: readonly ClawbackLine[];
  readonly refunds: readonly RefundLine[];
  readonly bank: BankAccountFacts | null;
  readonly hash: string;
}

export class PayoutSnapshotError extends Error {
  constructor(readonly code: "lines_disagree_with_balance") {
    super(`payout snapshot: ${code}`);
    this.name = "PayoutSnapshotError";
  }
}

/** Entry sums per clawback id over `kinds`; order and customer are those of the `origin` entry (the clawback's original, or the credit). */
function entrySums(db: LedgerDb, keys: readonly string[], kinds: readonly (typeof LEDGER_ENTRY_KINDS)[number][], origin: "CLAWBACK" | "NETTING_REFUND") {
  return db
    .select({
      clawbackId: ledgerEntries.clawbackId,
      total: sql<number>`sum(${ledgerEntries.amount})`,
      orderId: sql<string | null>`max(case when ${ledgerEntries.kind} = ${origin} then ${ledgerEntries.orderId} end)`,
      customerId: sql<string>`max(case when ${ledgerEntries.kind} = ${origin} then ${ledgerEntries.customerId} end)`,
    })
    .from(ledgerEntries)
    .where(and(inArray(ledgerEntries.customerId, [...keys]), inArray(ledgerEntries.kind, [...kinds])))
    .groupBy(ledgerEntries.clawbackId)
    .orderBy(ledgerEntries.clawbackId)
    .all();
}

/** The void credits still owed, one per clawback whose netting a void gave back. */
function openRefunds(db: LedgerDb, keys: readonly string[]): RefundLine[] {
  return entrySums(db, keys, CREDIT_KINDS, "NETTING_REFUND")
    .map((r) => ({ clawbackId: r.clawbackId, customerId: r.customerId, orderId: r.orderId, amount: creditOpenAmount([r.total]) }))
    .filter((r) => r.amount > 0);
}

/** The open clawbacks under the stored ids, each with what it still owes back (AD-6, D42). */
export function openClawbacks(db: LedgerDb, keys: readonly string[]): ClawbackLine[] {
  const rows = entrySums(db, keys, CLAWBACK_KINDS, "CLAWBACK");
  return rows.map((r) => ({ clawbackId: r.clawbackId, customerId: r.customerId, orderId: r.orderId, open: openClawbackTotal([clawbackOpenAmount([r.total])]) })).filter((c) => c.open > 0);
}

export function snapshotHash(s: Omit<PayoutSnapshot, "hash" | "customerCode" | "customerName">): string {
  const bank = s.balance.payable === 0 ? null : s.bank;
  const canonical = JSON.stringify({
    customerId: s.customerId,
    orders: s.orders.map((o) => [o.orderId, o.cashback]),
    awards: s.bonuses.map((b) => [b.awardId, b.amount]),
    clawbacks: s.clawbacks.map((c) => [c.clawbackId, c.open]),
    refunds: s.refunds.map((r) => [r.clawbackId, r.amount]),
    amount: s.balance.payable,
    bankFingerprint: bank?.fingerprint ?? null,
    bankHeld: bank?.held ?? null,
    bankName: bank === null ? null : plainBankText(bank.bankName ?? ""),
    bankBin: bank?.vietQrBank?.bin ?? null,
    holder: bank?.holderName?.trim() ?? null,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** The snapshot for the customer behind `key` (id, code or alias), or null for nobody, an erased customer or HOUSE. */
export function payoutSnapshot(db: LedgerDb, key: string): PayoutSnapshot | null {
  const found = customerKeys(db, key);
  if (found === null || found.customer.role === "HOUSE") return null;
  const customerId = found.customer.customerId;
  const [balance] = getBalances(db, [customerId]);
  if (balance === undefined) return null;
  const orders = payableOrderLines(db, found.keys, true);
  const bonuses = confirmedBonusLines(db, found.keys, orderBalanceRows(db, found.keys).frozenOrderIds);
  const refunds = openRefunds(db, found.keys);
  if (sumDong([...orders.map((o) => o.cashback), ...bonuses.map((b) => b.amount), ...refunds.map((r) => r.amount)], "gross") !== balance.gross) throw new PayoutSnapshotError("lines_disagree_with_balance");
  const card = customerCardOf(db, customerId);
  const parts = { customerId, balance, orders, bonuses, clawbacks: openClawbacks(db, found.keys), refunds, bank: bankAccountsOf(db, [customerId]).get(customerId) ?? null };
  return { ...parts, customerCode: card?.customerCode ?? null, customerName: card?.displayName ?? null, hash: snapshotHash(parts) };
}

/** What confirming this snapshot nets and carries forward (AD-6): the preview shows it, confirm writes it. */
export const nettingOf = (snapshot: PayoutSnapshot): NettingPlan => nettingPlan(snapshot.balance.gross, snapshot.clawbacks);
