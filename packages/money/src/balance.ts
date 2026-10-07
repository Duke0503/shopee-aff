import { estimateCashback } from "./shopee-cap";

/**
 * What a customer is owed, in the three numbers shown on the site.
 * Ports `ledger/payouts.py::balance_for`.
 *
 *   approved, waiting for transfer = the SAVED cashback of approved, unpaid
 *                                    orders + confirmed campaign bonuses
 *   still with the shop            = the ESTIMATE of awaiting orders (tax
 *                                    always assumed) + bonuses not yet void
 *   already paid                   = the saved cashback of paid orders + their
 *                                    bonuses
 *
 * HOUSE (the guest account) is owed nothing.
 */
export interface BalanceInput {
  approvedUnpaidCashbackVnd: number[];
  awaitingEstimatedCommissionVnd: number[];
  paidCashbackVnd: number[];
  confirmedBonusVnd: number;
  awaitingBonusVnd: number;
  paidBonusVnd: number;
  cashbackRate: number;
  isHouse: boolean;
}

export interface Balance {
  approvedWaitingVnd: number;
  stillWithShopVnd: number;
  alreadyPaidVnd: number;
}

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

export function balanceFor(input: BalanceInput): Balance {
  if (input.isHouse) {
    return { approvedWaitingVnd: 0, stillWithShopVnd: 0, alreadyPaidVnd: 0 };
  }
  const stillWithShop =
    input.awaitingEstimatedCommissionVnd.reduce(
      (total, commission) => total + estimateCashback(commission, input.cashbackRate),
      0,
    ) + input.awaitingBonusVnd;

  return {
    approvedWaitingVnd: sum(input.approvedUnpaidCashbackVnd) + input.confirmedBonusVnd,
    stillWithShopVnd: stillWithShop,
    alreadyPaidVnd: sum(input.paidCashbackVnd) + input.paidBonusVnd,
  };
}
