import { findBank, type BankInfo } from "./bank-match";

/**
 * The VietQR fields the owner scans to pay one customer. Ports the QR step of
 * `ledger/payouts.py`.
 *
 * If the bank cannot be matched for certain, NO QR is made — a wrong guess
 * sends money to a stranger, and typing it by hand is better than that.
 */
export interface VietQrInput {
  bankName: string;
  accountNumber: string;
  amountVnd: number;
  note: string;
}

export interface VietQr {
  bankBin: string;
  accountNumber: string;
  amountVnd: number;
  note: string;
}

export function buildVietQr(input: VietQrInput, catalogue: BankInfo[]): VietQr | null {
  const bank = findBank(input.bankName, catalogue);
  if (!bank || !bank.bin) return null;
  return {
    bankBin: String(bank.bin),
    accountNumber: input.accountNumber,
    amountVnd: input.amountVnd,
    note: input.note,
  };
}
