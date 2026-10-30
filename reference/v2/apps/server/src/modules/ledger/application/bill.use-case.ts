import { eq } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { customers } from "../../../shared/database/schema";
import { estimateProductName, findLinkRequestById } from "../../affiliate";
import { maskBankAccount } from "../../identity";
import { bonusesForOrders, findOrder } from "../../orders";
import { billReference, billTime } from "../domain/bill";
import {
  decodeOrderIds,
  findTransferByBillToken,
  totalReceivedUpTo,
} from "../infrastructure/payment-transfer.repository";

/**
 * What one bill shows. Read-only: a receipt is a record of money already sent,
 * so nothing here writes and nothing here decides an amount. The orders are
 * asked for through Orders' own functions and the product name through
 * Affiliate's, never by reaching into their tables.
 */
export interface BillOrderLine {
  orderId: string;
  productName: string;
  cashbackVnd: number;
  bonusVnd: number;
  bonusCampaign: string;
}

export interface BillView {
  billToken: string;
  reference: string;
  customerName: string;
  customerCode: string;
  bankLabel: string;
  paidAt: string;
  amountVnd: number;
  receivedVnd: number;
  bonusVnd: number;
  bonusCampaigns: string[];
  orderLines: BillOrderLine[];
  hasProof: boolean;
}

export function billForToken(db: Db, billToken: string): BillView | null {
  const transfer = findTransferByBillToken(db, billToken);
  if (!transfer) return null;

  const customer =
    db
      .select()
      .from(customers)
      .where(eq(customers.customerId, transfer.customerId))
      .get() ?? null;

  const orderIds = decodeOrderIds(transfer.orderIds);
  const bonusesByOrder = new Map(
    bonusesForOrders(db, orderIds).map((bonus) => [bonus.orderId, bonus]),
  );

  const orderLines = orderIds.map((orderId) => {
    const order = findOrder(db, orderId);
    const bonus = bonusesByOrder.get(orderId);
    const request = order ? findLinkRequestById(db, order.requestId ?? "") : null;
    return {
      orderId,
      productName: estimateProductName(request?.estimateDetail ?? null),
      cashbackVnd: order?.cashbackAmount ?? 0,
      bonusVnd: bonus?.bonusVnd ?? 0,
      bonusCampaign: bonus?.campaignName ?? "",
    };
  });

  const bonusCampaigns = [
    ...new Set(orderLines.map((line) => line.bonusCampaign).filter((name) => name !== "")),
  ];
  const bankLabel = [customer?.bankName ?? "", maskBankAccount(customer?.bankAccount ?? null)]
    .filter((part) => part !== "")
    .join(" · ");

  return {
    billToken,
    reference: billReference(transfer.transferCode, transfer.id),
    customerName: customer?.displayName ?? "",
    customerCode: customer?.customerCode ?? transfer.customerId,
    bankLabel,
    paidAt: billTime(transfer.createdAt),
    amountVnd: transfer.amount,
    receivedVnd: totalReceivedUpTo(db, transfer.customerId, transfer.id),
    bonusVnd: orderLines.reduce((sum, line) => sum + line.bonusVnd, 0),
    bonusCampaigns,
    orderLines,
    hasProof: (transfer.proofImage ?? "").trim() !== "",
  };
}
