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
