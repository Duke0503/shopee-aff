/**
 * The bank account from the customer website, and the confirmation that releases it (AD-17,
 * AD-23, FR-10, M-7, INV-5, INV-9, INV-11; Story 7.5).
 *
 * A save on the website is HELD (`pending_confirmation`) until the customer confirms it in the
 * Zalo private chat: whoever holds a website session (a phone left signed in, a guessed password)
 * must not be able to send the customer's money to their own account. While it is held, the
 * account is not one to pay to (`hasBankAccount`), the Payouts row sits in "needs action" with
 * BANK_HELD and the claim snapshot hashes the account and the hold, so an open claim no longer
 * confirms. Every save stores a new consent time, the change time the Payouts desk flags for 72
 * hours. The same account, already saved in another spelling, is `unchanged`: nothing is written,
 * nothing is held again and no message goes out.
 *
 * The confirmation (`/stk xacnhan <last four>` in the private chat) only lifts the hold: the consent time
 * stays, so the 72-hour flag of the change stays too. Erasing removes the row. Each act writes
 * its audit entry (fingerprints only) and tells the customer in Zalo with the last four digits,
 * in the same transaction; each saved account is its own message (the key names its fingerprint
 * prefix), so two changes in the same instant both reach the customer. Call inside `tx`.
 */
import { toMs } from "@cashback/core";
import { eq } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { dedupKey } from "../../platform/ports/outbox.port";
import type { BankSaveDeps, ChatBankAccount } from "./bank-account-save.command";
import { bankFingerprint, lastFour } from "./bank-fingerprint";
import { foldHolderName } from "./domain/bank-details";
import { findVietQrBank } from "./domain/bank-match";
import { bankAccounts } from "./schema";

/** The message a website save sends: the new last four digits and how to confirm. */
export const BANK_WEBSITE_MESSAGE = "bank_changed_website";
/** The message an erase sends. */
export const BANK_ERASED_MESSAGE = "bank_erased";

export type WebsiteBankAccount = ChatBankAccount;

export interface WebsiteBankSaved {
  readonly result: "saved" | "changed" | "unchanged";
  readonly bankName: string;
  readonly holderName: string;
  readonly lastFour: string;
  readonly held: boolean;
}

const rowOf = (db: LedgerDb, customerId: string) => db.select().from(bankAccounts).where(eq(bankAccounts.customerId, customerId)).get();

export function saveWebsiteBankAccount(db: LedgerDb, account: WebsiteBankAccount, deps: BankSaveDeps): WebsiteBankSaved {
  const fingerprint = bankFingerprint(deps.fingerprintKey, account.accountNumber);
  const bankName = account.bank.shortName;
  const shown = { bankName, holderName: account.holderName, lastFour: lastFour(account.accountNumber) };
  const before = rowOf(db, account.customerId);
  const same = before !== undefined && before.fingerprint === fingerprint && findVietQrBank(before.bankName)?.bin === account.bank.bin && foldHolderName(before.holderName ?? "") === account.holderName;
  if (same) return { result: "unchanged", ...shown, held: before.pendingConfirmation };
  const now = deps.clock.now();
  const row = { bankName, accountNumber: account.accountNumber, holderName: account.holderName, fingerprint, consentAt: now, pendingConfirmation: true };
  db.insert(bankAccounts)
    .values({ customerId: account.customerId, ...row })
    .onConflictDoUpdate({ target: bankAccounts.customerId, set: row })
    .run();
  deps.by.audit.record({
    actor: deps.by.actor,
    event: "identity.bank_account.saved",
    entityId: account.customerId,
    payload: { customerId: account.customerId, bankFingerprint: fingerprint, ...(before === undefined ? {} : { previousFingerprint: before.fingerprint }), via: "website", held: true },
  });
  deps.outbox.enqueue({ dedupKey: dedupKey("bank_account", `${account.customerId}.${toMs(now)}.${fingerprint.slice(0, 12)}`, "website"), customerId: account.customerId, messageKey: BANK_WEBSITE_MESSAGE, params: { bank: bankName, lastFour: shown.lastFour } });
  return { result: before === undefined ? "saved" : "changed", ...shown, held: true };
}

/** Erases the customer's bank account; false when there was none. */
export function eraseWebsiteBankAccount(db: LedgerDb, customerId: string, deps: Omit<BankSaveDeps, "fingerprintKey">): boolean {
  const before = rowOf(db, customerId);
  if (before === undefined) return false;
  db.delete(bankAccounts).where(eq(bankAccounts.customerId, customerId)).run();
  deps.by.audit.record({ actor: deps.by.actor, event: "identity.bank_account.erased", entityId: customerId, payload: { customerId, bankFingerprint: before.fingerprint, via: "website", wasHeld: before.pendingConfirmation } });
  const bank = findVietQrBank(before.bankName)?.shortName ?? before.bankName ?? "";
  const now = deps.clock.now();
  deps.outbox.enqueue({ dedupKey: dedupKey("bank_account", `${customerId}.${toMs(now)}`, "erased"), customerId, messageKey: BANK_ERASED_MESSAGE, params: { bank, lastFour: lastFour(before.accountNumber) } });
  return true;
}

export type BankConfirmation =
  | { readonly result: "confirmed" | "already_confirmed"; readonly bankName: string; readonly lastFour: string }
  | { readonly result: "mismatch"; readonly lastFour: string }
  | { readonly result: "none" };

/**
 * The customer confirms a held website change in the private chat, naming its last four digits
 * (the ones the change message showed): only the account they were told about is confirmed. Other
 * digits, or none, confirm nothing and the answer names the account that waits. The hold ends; the
 * consent time (and its 72-hour flag) stays.
 */
export function confirmHeldBankAccount(db: LedgerDb, customerId: string, typedLastFour: string | null, deps: Pick<BankSaveDeps, "by">): BankConfirmation {
  const before = rowOf(db, customerId);
  if (before === undefined) return { result: "none" };
  const shown = { bankName: findVietQrBank(before.bankName)?.shortName ?? before.bankName ?? "", lastFour: lastFour(before.accountNumber) };
  if (typedLastFour === null || typedLastFour.toUpperCase() !== shown.lastFour) return { result: "mismatch", lastFour: shown.lastFour };
  if (!before.pendingConfirmation) return { result: "already_confirmed", ...shown };
  db.update(bankAccounts).set({ pendingConfirmation: false }).where(eq(bankAccounts.customerId, customerId)).run();
  deps.by.audit.record({ actor: deps.by.actor, event: "identity.bank_account.confirmed", entityId: customerId, payload: { customerId, bankFingerprint: before.fingerprint, via: "zalo_private" } });
  return { result: "confirmed", ...shown };
}
