/**
 * Bank accounts as the payout screens read them (FR-10, FR-16, FR-31, AD-17, INV-9). A list or a
 * preview gets the bank, the holder, the last four digits, the fingerprint and the facts the
 * flags need; only `accountNumberOf` returns the full number, for the VietQR and the audited copy
 * button of the payout panel. The VietQR bank is matched here once, so the list and the QR name
 * the same bank.
 *
 * A bank account is shared when its fingerprint is saved for another customer who still exists
 * (FR-31, the one fraud flag of v1). The change time is the consent time: every save of an
 * account stores a new consent time with it (FR-10), and a confirmation in Zalo does not change it.
 */
import { eq, inArray, sql } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { lastFour } from "./bank-fingerprint";
import { findVietQrBank, type VietQrBank } from "./domain/bank-match";
import { bankAccounts, customers } from "./schema";

export interface BankAccountFacts {
  readonly customerId: string;
  /** The bank as the customer wrote it. */
  readonly bankName: string | null;
  /** The one VietQR bank the name matches, or null (no QR then, M-7). */
  readonly vietQrBank: VietQrBank | null;
  readonly holderName: string | null;
  readonly lastFour: string;
  readonly fingerprint: string;
  /** A website change not yet confirmed in Zalo: payouts are held (FR-10). */
  readonly held: boolean;
  /** When the account was last saved, or null for an imported account without a time. */
  readonly changedAt: string | null;
}

const columns = {
  customerId: bankAccounts.customerId,
  bankName: bankAccounts.bankName,
  accountNumber: bankAccounts.accountNumber,
  holderName: bankAccounts.holderName,
  fingerprint: bankAccounts.fingerprint,
  pendingConfirmation: bankAccounts.pendingConfirmation,
  consentAt: bankAccounts.consentAt,
};

/** The saved account of each customer named, by customer id; a customer without one is absent. */
export function bankAccountsOf(db: LedgerDb, customerIds: readonly string[]): Map<string, BankAccountFacts> {
  if (customerIds.length === 0) return new Map();
  const rows = db.select(columns).from(bankAccounts).where(inArray(bankAccounts.customerId, [...customerIds])).all();
  return new Map(
    rows.map((r) => [
      r.customerId,
      {
        customerId: r.customerId,
        bankName: r.bankName,
        vietQrBank: findVietQrBank(r.bankName),
        holderName: r.holderName,
        lastFour: lastFour(r.accountNumber),
        fingerprint: r.fingerprint,
        held: r.pendingConfirmation,
        changedAt: r.consentAt,
      },
    ]),
  );
}

/** The bank name a desk screen shows: the matched VietQR bank's short name, else the name as written. */
export const bankDisplayName = (bank: BankAccountFacts): string | null => bank.vietQrBank?.shortName ?? bank.bankName;

/** The full account number, for the VietQR payload and the audited copy only (never a list or a log). */
export function accountNumberOf(db: LedgerDb, customerId: string): string | null {
  return db.select({ number: bankAccounts.accountNumber }).from(bankAccounts).where(eq(bankAccounts.customerId, customerId)).get()?.number ?? null;
}

/** Fingerprints saved for two or more customers who still exist (not merged, not erased). */
export function sharedBankFingerprints(db: LedgerDb): Set<string> {
  const rows = db
    .select({ fingerprint: bankAccounts.fingerprint })
    .from(bankAccounts)
    .innerJoin(customers, eq(customers.customerId, bankAccounts.customerId))
    .where(inArray(customers.status, ["ACTIVE", "DISABLED"]))
    .groupBy(bankAccounts.fingerprint)
    .having(sql`count(distinct ${bankAccounts.customerId}) > 1`)
    .all();
  return new Set(rows.map((r) => r.fingerprint));
}
