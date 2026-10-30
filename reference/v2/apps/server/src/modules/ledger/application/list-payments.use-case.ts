import { eq } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { customers } from "../../../shared/database/schema";
import type { Payable } from "../domain/payables";
import { collectPayablesFromDb } from "../infrastructure/payables.repository";
import { decodeOrderIds, listTransfers } from "../infrastructure/payment-transfer.repository";

/** Who the money is going to, as the owner must see it before sending any. */
export interface PaymentCustomer {
  customerId: string;
  customerCode: string | null;
  displayName: string | null;
  bankName: string | null;
  bankAccount: string | null;
  accountHolder: string | null;
}

/** One customer to pay: the ledger's payable, plus who they are. */
export interface PaymentRow extends Payable, PaymentCustomer {}

/** A transfer already recorded, as the history table shows it. */
export interface PaymentTransferRow {
  id: number;
  customerId: string | null;
  amountVnd: number;
  transferCode: string | null;
  note: string | null;
  orderIds: string[];
  createdAt: string;
  notifiedAt: string | null;
}

export interface PaymentsView {
  payables: { ready: PaymentRow[]; blocked: PaymentRow[] };
  totals: PaymentTotals;
  transfers: PaymentTransferRow[];
}

/** What the screen's summary shows, added up once on the server. */
export interface PaymentTotals {
  readyCount: number;
  readyVnd: number;
  blockedCount: number;
  blockedVnd: number;
  /** Everyone with something owed, and the whole figure. */
  allCount: number;
  allVnd: number;
}

const sumVnd = (rows: PaymentRow[]): number => rows.reduce((sum, row) => sum + row.amountVnd, 0);

/** Every customer's identity in one read, so a payout list needs no N+1. */
function customerDetails(db: Db): Map<string, PaymentCustomer> {
  const rows = db
    .select({
      customerId: customers.customerId,
      customerCode: customers.customerCode,
      displayName: customers.displayName,
      bankName: customers.bankName,
      bankAccount: customers.bankAccount,
      accountHolder: customers.accountHolder,
    })
    .from(customers)
    .all();
  return new Map(rows.map((row) => [row.customerId, row]));
}

const unknownCustomer = (customerId: string): PaymentCustomer => ({
  customerId,
  customerCode: null,
  displayName: null,
  bankName: null,
  bankAccount: null,
  accountHolder: null,
});

/**
 * The money-out desk's whole read: who can be paid now, who is blocked (and
 * why), and what has already been sent. The amounts come from the ledger's own
 * `collectPayablesFromDb`; this only says who each row is.
 */
export function listPayments(db: Db, nowIso: string): PaymentsView {
  const payables = collectPayablesFromDb(db, nowIso);
  const details = customerDetails(db);
  const view = (payable: Payable): PaymentRow => ({
    ...(details.get(payable.customerId) ?? unknownCustomer(payable.customerId)),
    ...payable,
  });
  const ready = payables.ready.map(view);
  const blocked = payables.blocked.map(view);

  return {
    payables: { ready, blocked },
    totals: {
      readyCount: ready.length,
      readyVnd: sumVnd(ready),
      blockedCount: blocked.length,
      blockedVnd: sumVnd(blocked),
      allCount: ready.length + blocked.length,
      allVnd: sumVnd([...ready, ...blocked]),
    },
    transfers: listTransfers(db).map((transfer) => ({
      id: transfer.id,
      customerId: transfer.customerId,
      amountVnd: transfer.amount,
      transferCode: transfer.transferCode,
      note: transfer.note,
      orderIds: decodeOrderIds(transfer.orderIds),
      createdAt: transfer.createdAt,
      notifiedAt: transfer.notifiedAt,
    })),
  };
}

/** One customer, for a screen that shows a single payout. */
export function findPaymentCustomer(db: Db, customerId: string): PaymentCustomer | null {
  const row = db
    .select({
      customerId: customers.customerId,
      customerCode: customers.customerCode,
      displayName: customers.displayName,
      bankName: customers.bankName,
      bankAccount: customers.bankAccount,
      accountHolder: customers.accountHolder,
    })
    .from(customers)
    .where(eq(customers.customerId, customerId))
    .get();
  return row ?? null;
}
