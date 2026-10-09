import { and, eq, isNotNull, isNull } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { customers, paymentTransfers } from "../../../shared/database/schema";
import type { DeliveryPort, NotifyResult } from "../../../notifications/delivery";
import { formatVnd, render, type Messages } from "../../../notifications/messages";

/**
 * Telling a customer their money was sent. Ports the payout step: a transfer
 * row is marked notified only after the assistant confirms delivery, and a
 * second pass never sends the same transfer twice.
 */
export interface NotifyPayoutsDeps {
  db: Db;
  delivery: DeliveryPort;
  messages: Messages;
  now: () => string;
}

function orderCount(orderIds: string | null): number {
  if (!orderIds) return 0;
  try {
    const parsed = JSON.parse(orderIds) as unknown;
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function bankLine(row: {
  bankName: string | null;
  bankAccount: string | null;
  accountHolder: string | null;
}): string {
  return [row.bankName, row.bankAccount, row.accountHolder]
    .filter((part): part is string => part !== null && part !== "")
    .join(" - ");
}

export async function notifyPayouts(deps: NotifyPayoutsDeps): Promise<NotifyResult> {
  const rows = deps.db
    .select({
      id: paymentTransfers.id,
      amount: paymentTransfers.amount,
      transferCode: paymentTransfers.transferCode,
      note: paymentTransfers.note,
      orderIds: paymentTransfers.orderIds,
      zaloUserId: customers.zaloUserId,
      bankName: customers.bankName,
      bankAccount: customers.bankAccount,
      accountHolder: customers.accountHolder,
    })
    .from(paymentTransfers)
    .innerJoin(customers, eq(paymentTransfers.customerId, customers.customerId))
    .where(and(isNull(paymentTransfers.notifiedAt), isNotNull(customers.zaloUserId)))
    .all();

  let sent = 0;
  for (const row of rows) {
    if (!row.zaloUserId) continue;
    const bank = bankLine(row);
    const text = render(deps.messages, bank ? "order_paid" : "order_paid_no_bank", {
      amount: formatVnd(deps.messages, row.amount),
      count: orderCount(row.orderIds),
      bank,
      reference: row.transferCode ?? row.note ?? "",
    });
    if (!(await deps.delivery.sendPrivate(row.zaloUserId, text))) continue;
    deps.db
      .update(paymentTransfers)
      .set({ notifiedAt: deps.now() })
      .where(eq(paymentTransfers.id, row.id))
      .run();
    sent += 1;
  }

  return { sent, failed: rows.length - sent };
}
