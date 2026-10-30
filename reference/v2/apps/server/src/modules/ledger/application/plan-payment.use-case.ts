import type { Db } from "../../../shared/database/connection";
import { findOrder } from "../../orders";
import { buildVietQr, type VietQr } from "../domain/vietqr";
import { loadBankCatalogue } from "../infrastructure/banks.repository";
import { payableOrderIdsForCustomer } from "../infrastructure/payables.repository";
import { planPayoutFromDb } from "./confirm-payout.use-case";
import { findPaymentCustomer, type PaymentCustomer } from "./list-payments.use-case";

/** One order the payout would cover, as the dialog lists it. */
export interface PaymentOrderLine {
  orderId: string;
  cashbackVnd: number;
  approvedAt: string | null;
  recordedAt: string | null;
}

/**
 * What paying one customer right now would mean. Worked out from the database
 * through `planPayoutFromDb` — the same plan `confirmPayout` records, so the
 * figure the owner reads is the figure that will be written. Nothing here
 * writes anything.
 */
export interface PaymentPlan extends PaymentCustomer {
  orders: PaymentOrderLine[];
  ordersVnd: number;
  bonusVnd: number;
  totalVnd: number;
  /** What the owner types into the bank app so the customer can be matched. */
  memo: string;
  /** Null when the bank cannot be matched for certain: pay by hand instead. */
  qr: VietQr | null;
}

function orderLine(db: Db, orderId: string): PaymentOrderLine {
  const order = findOrder(db, orderId);
  return {
    orderId,
    cashbackVnd: order?.cashbackAmount ?? 0,
    approvedAt: order?.approvedAt ?? null,
    recordedAt: order?.recordedAt ?? null,
  };
}

export function planPaymentFor(db: Db, customerId: string): PaymentPlan | null {
  const customer = findPaymentCustomer(db, customerId);
  if (customer === null) return null;

  const orderIds = payableOrderIdsForCustomer(db, customerId);
  const plan = planPayoutFromDb(db, orderIds);
  const memo = customer.customerCode ?? customerId;

  return {
    ...customer,
    orders: orderIds.map((orderId) => orderLine(db, orderId)),
    ordersVnd: plan.ordersVnd,
    bonusVnd: plan.bonusVnd,
    totalVnd: plan.totalVnd,
    memo,
    qr:
      customer.bankAccount === null
        ? null
        : buildVietQr(
            {
              bankName: customer.bankName ?? "",
              accountNumber: customer.bankAccount,
              amountVnd: plan.totalVnd,
              note: memo,
            },
            loadBankCatalogue(),
          ),
  };
}
