import { and, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { customers, orders } from "../../../shared/database/schema";
import type { DeliveryPort, NotifyResult } from "../../../notifications/delivery";
import { formatVnd, render, type Messages } from "../../../notifications/messages";
import { APPROVED, AWAITING_APPROVAL, REJECTED } from "../domain/order";

/**
 * Telling a customer their order moved. Ports the "order changes" step of the
 * old notify loop. The rule that keeps this safe: an order is marked notified
 * only **after** the assistant confirms delivery, so a message is never lost
 * because the assistant was restarting.
 */

/** The order statuses that have something to say. Paid is told via the payout. */
const NOTIFIABLE = [AWAITING_APPROVAL, APPROVED, REJECTED] as const;

export interface NotifyOrderChangesDeps {
  db: Db;
  delivery: DeliveryPort;
  messages: Messages;
}

interface PendingOrder {
  orderId: string;
  status: string;
  cashbackAmount: number | null;
  estimatedCommission: number | null;
  rejectionReason: string | null;
  customerId: string;
  zaloUserId: string | null;
  bankName: string | null;
  bankAccount: string | null;
  accountHolder: string | null;
}

function bankLine(row: Pick<PendingOrder, "bankName" | "bankAccount" | "accountHolder">): string {
  return [row.bankName, row.bankAccount, row.accountHolder]
    .filter((part): part is string => part !== null && part !== "")
    .join(" - ");
}

/** What the customer has approved and not yet paid — same filter as the balance. */
function approvedTotal(db: Db, customerId: string): number {
  return db
    .select({ status: orders.status, paidAt: orders.paidAt, cashbackAmount: orders.cashbackAmount })
    .from(orders)
    .where(eq(orders.customerId, customerId))
    .all()
    .filter((row) => row.status === APPROVED && row.paidAt === null)
    .reduce((sum, row) => sum + (row.cashbackAmount ?? 0), 0);
}

function orderMessage(messages: Messages, db: Db, row: PendingOrder): string | null {
  const identity = render(messages, "order_identity_product", {
    product: render(messages, "order_fallback_name", { order_id: row.orderId }),
  });

  switch (row.status) {
    case AWAITING_APPROVAL:
      return render(messages, "order_recorded", {
        identity,
        cashback: formatVnd(messages, row.estimatedCommission ?? 0),
        order_id: row.orderId,
        days: render(messages, "payout_window"),
      });
    case APPROVED: {
      const bank = bankLine(row);
      return render(messages, "order_approved", {
        identity,
        cashback: formatVnd(messages, row.cashbackAmount ?? 0),
        order_id: row.orderId,
        payout_note: render(messages, bank ? "payout_note_ready" : "payout_note_ready_need_bank", {
          total: formatVnd(messages, approvedTotal(db, row.customerId)),
          bank,
        }),
      });
    }
    case REJECTED:
      return render(messages, "order_rejected", {
        identity,
        order_id: row.orderId,
        reason: row.rejectionReason ?? "",
      });
    default:
      return null;
  }
}

function pendingOrders(db: Db): PendingOrder[] {
  return db
    .select({
      orderId: orders.orderId,
      status: orders.status,
      cashbackAmount: orders.cashbackAmount,
      estimatedCommission: orders.estimatedCommission,
      rejectionReason: orders.rejectionReason,
      customerId: orders.customerId,
      zaloUserId: customers.zaloUserId,
      bankName: customers.bankName,
      bankAccount: customers.bankAccount,
      accountHolder: customers.accountHolder,
    })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.customerId))
    .where(
      and(
        isNotNull(orders.customerId),
        isNotNull(customers.zaloUserId),
        or(isNull(orders.notifiedStatus), ne(orders.notifiedStatus, orders.status)),
        inArray(orders.status, [...NOTIFIABLE]),
      ),
    )
    .all()
    .map((row) => ({ ...row, customerId: row.customerId ?? "" }));
}

/** One pass over the order changes. Safe to run again: only unmark-notified rows go. */
export async function notifyOrderChanges(deps: NotifyOrderChangesDeps): Promise<NotifyResult> {
  const rows = pendingOrders(deps.db);
  let sent = 0;

  for (const row of rows) {
    if (!row.zaloUserId) continue;
    const text = orderMessage(deps.messages, deps.db, row);
    if (!text) continue;
    if (!(await deps.delivery.sendPrivate(row.zaloUserId, text))) continue;
    deps.db
      .update(orders)
      .set({ notifiedStatus: row.status })
      .where(eq(orders.orderId, row.orderId))
      .run();
    sent += 1;
  }

  return { sent, failed: rows.length - sent };
}
