import { and, eq, isNotNull, isNull } from "drizzle-orm";

import type { DeliveryPort, NotifyResult } from "../../../notifications/delivery";
import { formatVnd, render, type Messages } from "../../../notifications/messages";
import { publicUrl } from "../../../shared/config/public-base-url";
import type { Db } from "../../../shared/database/connection";
import { customers, paymentTransfers } from "../../../shared/database/schema";
import { decodeOrderIds } from "../infrastructure/payment-transfer.repository";

/**
 * Telling a customer their money was sent. Ports the payout step: a transfer
 * row is marked notified only after the assistant confirms delivery, and a
 * second pass never sends the same transfer twice.
 *
 * The message ends with the bill link — the receipt for exactly this transfer —
 * built from the row's own `bill_token`. A transfer with no token (one recorded
 * before tokens existed) simply gets no link: a bill is never addressed by its
 * row number.
 */
export interface NotifyPayoutsDeps {
  db: Db;
  delivery: DeliveryPort;
  messages: Messages;
  now: () => string;
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
      billToken: paymentTransfers.billToken,
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
    const lines = [
      render(deps.messages, bank ? "order_paid" : "order_paid_no_bank", {
        amount: formatVnd(deps.messages, row.amount),
        count: decodeOrderIds(row.orderIds).length,
        bank,
        reference: row.transferCode ?? row.note ?? "",
      }),
    ];
    if (row.billToken) {
      lines.push(
        render(deps.messages, "order_paid_bill_line", { url: publicUrl(`/b/${row.billToken}`) }),
      );
    }
    const text = lines.join("\n");
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
