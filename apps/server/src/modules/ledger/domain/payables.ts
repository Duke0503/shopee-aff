/**
 * Collecting what each customer is owed. Ports `ledger/payouts.py`.
 *
 * There is NO minimum payout: everything approved and unpaid can be paid.
 * The only thing that blocks a payout is a MISSING bank account, and only the
 * customer can fix that. An account changed in the last 72 hours is flagged so
 * the owner looks twice before sending money.
 */

/** How long a recently changed bank account stays flagged. */
export const BANK_CHANGE_FLAG_HOURS = 72;

export interface PayableInput {
  customerId: string;
  approvedUnpaidCashbackVnd: number;
  confirmedBonusVnd: number;
  hasBankAccount: boolean;
  bankChangedAtIso: string | null;
}

export interface Payable {
  customerId: string;
  amountVnd: number;
  blockedReason: string | null;
  bankChangedRecently: boolean;
}

export interface Payables {
  ready: Payable[];
  blocked: Payable[];
}

const byAmountDesc = (a: Payable, b: Payable): number => b.amountVnd - a.amountVnd;

export function collectPayables(
  items: PayableInput[],
  nowIso: string,
  recentHours: number = BANK_CHANGE_FLAG_HOURS,
): Payables {
  const now = Date.parse(nowIso);
  const payables = items
    .map((item) => {
      const amountVnd = item.approvedUnpaidCashbackVnd + item.confirmedBonusVnd;
      const bankChangedRecently =
        item.bankChangedAtIso !== null &&
        now - Date.parse(item.bankChangedAtIso) <= recentHours * 3_600_000;
      return {
        customerId: item.customerId,
        amountVnd,
        blockedReason: item.hasBankAccount ? null : "no bank account on file",
        bankChangedRecently,
      };
    })
    .filter((payable) => payable.amountVnd > 0);

  return {
    ready: payables.filter((p) => p.blockedReason === null).sort(byAmountDesc),
    blocked: payables.filter((p) => p.blockedReason !== null).sort(byAmountDesc),
  };
}
