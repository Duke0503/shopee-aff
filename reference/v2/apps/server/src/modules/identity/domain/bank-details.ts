/**
 * A customer's bank details. Saving them records consent (Vietnam's personal
 * data protection law); erasing clears all four fields at once.
 * Ports the columns handled by `ledger/repository.py`.
 */
export interface BankDetails {
  bankName: string | null;
  bankAccount: string | null;
  accountHolder: string | null;
  consentAt: string | null;
}

export const EMPTY_BANK_DETAILS: BankDetails = {
  bankName: null,
  bankAccount: null,
  accountHolder: null,
  consentAt: null,
};

/** A payout is blocked only by a missing bank account. */
export const hasBankDetails = (details: Pick<BankDetails, "bankAccount">): boolean =>
  Boolean(details.bankAccount);

export function saveBankDetails(
  bankName: string,
  bankAccount: string,
  accountHolder: string,
  consentAt: string,
): BankDetails {
  return { bankName, bankAccount, accountHolder, consentAt };
}

/** Erase on request; all four fields go together. */
export function eraseBankDetails(): BankDetails {
  return { ...EMPTY_BANK_DETAILS };
}

/**
 * A bank account as it may be shown to anyone: never the whole number.
 * `0123456789` becomes `01****6789`, and a short number is hidden completely —
 * a receipt with a partly hidden account is still a receipt worth having the
 * customer check, but the full number is not something to hand out.
 */
export function maskBankAccount(account: string | null): string {
  const value = (account ?? "").trim();
  if (value === "") return "";
  if (value.length <= 4) return "*".repeat(value.length);
  return `${value.slice(0, 2)}****${value.slice(-4)}`;
}
