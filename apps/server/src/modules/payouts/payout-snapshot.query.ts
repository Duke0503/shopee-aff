/**
 * What one payout would cover right now (AD-6, AD-9, D19, D27, INV-3, INV-4): the payable orders
 * and confirmed bonuses one by one, the open clawbacks it nets, the amount, the bank account and
 * the hold, and the hash of all of it. The amount is `getBalances` payable, the one definition,
 * and the lines are read under the same conditions as its sums; if they ever disagreed the
 * snapshot throws instead of showing a QR for a figure nobody can explain. The browser sends no
 * amount and no order list: everything here is the server's (INV-4).
 *
 * The hash covers exactly what confirm re-checks (Story 4.8): customer, order ids with their
 * stored cashback, award ids with their amounts, clawback ids with their open amounts, the
 * amount, and the bank account as a whole: its fingerprint, the hold flag, the bank as written
 * (folded), the VietQR BIN it matches and the holder. A change to any of them is a new claim.
 */
import { createHash } from "node:crypto";
import { clawbackOpenAmount, openClawbackTotal, sumDong } from "@cashback/money";
import { inArray, sql } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { confirmedBonusLines, type BonusLine } from "../campaigns/index";
import { bankAccountsOf, customerCardOf, customerKeys, plainBankText, type BankAccountFacts } from "../identity/index";
import { orderBalanceRows, payableOrderLines, type PayableOrderLine } from "../orders/index";
import { getBalances, type Balance } from "./balance.query";
import { ledgerEntries } from "./schema";

export interface ClawbackLine {
  readonly clawbackId: string;
  readonly orderId: string | null;
  /** Still owed back, positive. */
  readonly open: number;
}

export interface PayoutSnapshot {
  readonly customerId: string;
  readonly customerCode: string | null;
  readonly customerName: string | null;
  readonly balance: Balance;
  readonly orders: readonly PayableOrderLine[];
  readonly bonuses: readonly BonusLine[];
  readonly clawbacks: readonly ClawbackLine[];
  readonly bank: BankAccountFacts | null;
  readonly hash: string;
}

export class PayoutSnapshotError extends Error {
  constructor(readonly code: "lines_disagree_with_balance") {
    super(`payout snapshot: ${code}`);
    this.name = "PayoutSnapshotError";
  }
}

function openClawbacks(db: LedgerDb, keys: readonly string[]): ClawbackLine[] {
  const rows = db
    .select({ clawbackId: ledgerEntries.clawbackId, total: sql<number>`sum(${ledgerEntries.amount})`, orderId: sql<string | null>`max(case when ${ledgerEntries.kind} = 'CLAWBACK' then ${ledgerEntries.orderId} end)` })
    .from(ledgerEntries)
    .where(inArray(ledgerEntries.customerId, [...keys]))
    .groupBy(ledgerEntries.clawbackId)
    .orderBy(ledgerEntries.clawbackId)
    .all();
  return rows.map((r) => ({ clawbackId: r.clawbackId, orderId: r.orderId, open: openClawbackTotal([clawbackOpenAmount([r.total])]) })).filter((c) => c.open > 0);
}

export function snapshotHash(s: Omit<PayoutSnapshot, "hash" | "customerCode" | "customerName">): string {
  const canonical = JSON.stringify({
    customerId: s.customerId,
    orders: s.orders.map((o) => [o.orderId, o.cashback]),
    awards: s.bonuses.map((b) => [b.awardId, b.amount]),
    clawbacks: s.clawbacks.map((c) => [c.clawbackId, c.open]),
    amount: s.balance.payable,
    bankFingerprint: s.bank?.fingerprint ?? null,
    bankHeld: s.bank?.held ?? null,
    bankName: s.bank === null ? null : plainBankText(s.bank.bankName ?? ""),
    bankBin: s.bank?.vietQrBank?.bin ?? null,
    holder: s.bank?.holderName?.trim() ?? null,
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
  if (sumDong([...orders.map((o) => o.cashback), ...bonuses.map((b) => b.amount)], "gross") !== balance.gross) throw new PayoutSnapshotError("lines_disagree_with_balance");
  const card = customerCardOf(db, customerId);
  const parts = { customerId, balance, orders, bonuses, clawbacks: openClawbacks(db, found.keys), bank: bankAccountsOf(db, [customerId]).get(customerId) ?? null };
  return { ...parts, customerCode: card?.customerCode ?? null, customerName: card?.displayName ?? null, hash: snapshotHash(parts) };
}
