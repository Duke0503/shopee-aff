/**
 * The money side of one customer's desk page (FR-15, FR-10, AD-6, Story 4.14): the balance card's
 * figures from `getBalances` (the same as the Customers row and the Payouts row), the flags of the
 * shared payout flag rules, the bank account with only its last four digits and whether it changed
 * within 72 hours, the open clawbacks, and how many payouts the customer has. No full account
 * number leaves this module here; the payout panel's audited copy is the only way to one.
 */
import type { CustomerPage, PayoutFlag } from "@cashback/contracts";
import type { Clock } from "@cashback/core";

import type { LedgerDb } from "../../platform/db/ledger";
import { bankAccountsOf, bankDisplayName, erasedIdsOf, sharedBankFingerprints } from "../identity/index";
import { getBalances, NO_BALANCE } from "./balance.query";
import { customerFlags } from "./customers.list";
import { payoutCountOf } from "./payout-history.list";
import { payoutFlags } from "./payout-flags";
import { openClawbacks } from "./payout-snapshot.query";

export type CustomerMoney = Pick<CustomerPage, "balance" | "flags" | "bank" | "clawbacks"> & {
  readonly payoutCount: number;
};

/** The figures of the survivor `customerId`, whose records sit under `keys` (its id and aliases). */
export function customerMoney(
  db: LedgerDb,
  customerId: string,
  keys: readonly string[],
  clock: Clock,
): CustomerMoney {
  const [found] = getBalances(db, [customerId]);
  const { customerId: _id, ...balance } = found ?? { customerId, ...NO_BALANCE };
  const bank = bankAccountsOf(db, [customerId]).get(customerId) ?? null;
  const all: PayoutFlag[] = payoutFlags({
    bank,
    sharedFingerprints: sharedBankFingerprints(db),
    payable: balance.payable,
    gross: balance.gross,
    now: clock.now(),
    erased: erasedIdsOf(db, [customerId]).has(customerId),
  });
  return {
    balance,
    flags: customerFlags(all, balance.gross),
    bank:
      bank === null
        ? null
        : {
            bankName: bankDisplayName(bank),
            holderName: bank.holderName,
            lastFour: bank.lastFour,
            changedAt: bank.changedAt,
            held: bank.held,
            changedRecently: all.includes("BANK_CHANGED"),
          },
    clawbacks: openClawbacks(db, keys).map((c) => ({
      clawbackId: c.clawbackId,
      orderId: c.orderId,
      open: c.open,
    })),
    payoutCount: payoutCountOf(db, keys),
  };
}
