/**
 * The public receipt behind `/b/<token>` (FR-18, D49, AD-21): a payout found by its unguessable
 * receipt token and nothing else, shown as facts only: the customer code, the last four digits of
 * the account paid into, the amount, the date and whether it was voided. The proof image, the
 * staff note, names and full account numbers are never part of it. Imported payouts keep the live
 * bill token, so every receipt link already sent still opens its payout.
 */
import { eq } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { customerCodeOf } from "../identity/index";
import { payouts } from "./schema";

export interface Receipt {
  readonly payoutId: number;
  readonly customerCode: string | null;
  readonly bankLastFour: string | null;
  readonly amount: number;
  readonly recordedAt: string | null;
  readonly voided: boolean;
  readonly voidedAt: string | null;
}

/**
 * Every shape a receipt token has had: the live system issued only `secrets.token_urlsafe(24)`
 * (repository.py:389-391, used by both admin screens and by _ensure_bill_tokens), 32 URL-safe
 * base64 characters; the range is wider so a longer or shorter random token still opens. An
 * all-digit value is an old `/b/<row number>` link, which never opens a receipt (it was
 * guessable; dashboard.py:4470-4472).
 */
const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

export const isReceiptToken = (token: string): boolean => TOKEN.test(token) && !/^\d+$/.test(token);

export function findReceipt(db: LedgerDb, token: string): Receipt | null {
  if (!isReceiptToken(token)) return null;
  const row = db
    .select({ payoutId: payouts.payoutId, customerId: payouts.customerId, bankLastFour: payouts.bankLastFour, amount: payouts.transferAmount, recordedAt: payouts.recordedAt, status: payouts.status, voidedAt: payouts.voidedAt })
    .from(payouts)
    .where(eq(payouts.receiptToken, token))
    .get();
  if (!row) return null;
  return {
    payoutId: row.payoutId,
    customerCode: customerCodeOf(db, row.customerId),
    bankLastFour: row.bankLastFour,
    amount: row.amount,
    recordedAt: row.recordedAt,
    voided: row.status === "VOIDED",
    voidedAt: row.status === "VOIDED" ? row.voidedAt : null,
  };
}
