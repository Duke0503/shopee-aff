/**
 * Saving a bank account from the Zalo private chat (AD-17, AD-23, FR-10, M-7, INV-5, INV-9,
 * INV-11; Story 6.9). The private chat is the customer's own channel, so a save there needs no
 * further confirmation (the accepted risk in SECURITY_MODEL.md): the account is stored confirmed,
 * which also settles a website change still held for confirmation. Every save stores a new consent
 * time, and the consent time is the change time the Payouts desk flags for 72 hours (payout-flags,
 * BANK_CHANGED); the claim snapshot hashes the account as a whole, so an open claim made for the
 * old account no longer confirms or reveals (D32). The same account sent again, already confirmed,
 * changes nothing and writes nothing, also when it is stored in another spelling (an imported
 * holder with accents, the bank as the customer once wrote it): the same fingerprint, the same
 * VietQR bank and the same holder once folded are the same account, so no notice goes out, the
 * consent time stays and an open claim still confirms.
 *
 * In the one transaction: the row, the audit entry (fingerprints only, never the number or the
 * holder) and, when another account was replaced, one change message with the new last four
 * digits through the outbox port. Call inside `tx`.
 */
import { toMs, type Clock } from "@cashback/core";
import { eq } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import type { CommandAudit } from "../../platform/ports/audit.port";
import { dedupKey, type OutboxPort } from "../../platform/ports/outbox.port";
import { bankFingerprint, lastFour } from "./bank-fingerprint";
import { foldHolderName } from "./domain/bank-details";
import { findVietQrBank, type VietQrBank } from "./domain/bank-match";
import { bankAccounts } from "./schema";

/** The message a changed account sends, in packages/labels/vi/messages.json. */
export const BANK_CHANGED_MESSAGE = "bank_changed";

export interface ChatBankAccount {
  readonly customerId: string;
  readonly bank: VietQrBank;
  /** Already normalised (readBankDetails). */
  readonly accountNumber: string;
  readonly holderName: string;
}

export interface BankSaveDeps {
  readonly clock: Clock;
  readonly fingerprintKey: string;
  readonly by: CommandAudit;
  readonly outbox: OutboxPort;
}

export type BankSaved = { readonly result: "saved" | "changed" | "unchanged"; readonly bankName: string; readonly lastFour: string };

export function saveChatBankAccount(db: LedgerDb, account: ChatBankAccount, deps: BankSaveDeps): BankSaved {
  const fingerprint = bankFingerprint(deps.fingerprintKey, account.accountNumber);
  const bankName = account.bank.shortName;
  const shown = { bankName, lastFour: lastFour(account.accountNumber) };
  const before = db.select().from(bankAccounts).where(eq(bankAccounts.customerId, account.customerId)).get();
  const same = before !== undefined && before.fingerprint === fingerprint && findVietQrBank(before.bankName)?.bin === account.bank.bin && foldHolderName(before.holderName ?? "") === account.holderName;
  if (same && !before.pendingConfirmation) return { result: "unchanged", ...shown };
  const now = deps.clock.now();
  const row = { bankName, accountNumber: account.accountNumber, holderName: account.holderName, fingerprint, consentAt: now, pendingConfirmation: false };
  db.insert(bankAccounts)
    .values({ customerId: account.customerId, ...row })
    .onConflictDoUpdate({ target: bankAccounts.customerId, set: row })
    .run();
  const changed = before !== undefined;
  deps.by.audit.record({
    actor: deps.by.actor,
    event: "identity.bank_account.saved",
    entityId: account.customerId,
    payload: { customerId: account.customerId, bankFingerprint: fingerprint, ...(before === undefined ? {} : { previousFingerprint: before.fingerprint }), via: "zalo_private", wasHeld: before?.pendingConfirmation ?? false },
  });
  if (changed) deps.outbox.enqueue({ dedupKey: dedupKey("bank_account", `${account.customerId}.${toMs(now)}`, "changed"), customerId: account.customerId, messageKey: BANK_CHANGED_MESSAGE, params: { bank: bankName, lastFour: shown.lastFour } });
  return { result: changed ? "changed" : "saved", ...shown };
}
