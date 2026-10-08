import type { ApiOrder } from "@mmo/contracts";

import type { BankRead } from "./commands";
import type { Reply } from "./handler";
import { formatVnd, render, type Messages } from "./messages";

/** The policy numbers a sentence needs. Wording never decides money. */
export interface WordingContext {
  customerId: string;
  ratePercent: string;
  attributionDays: number;
}

export interface WordedReply {
  key: string;
  values: Record<string, string | number>;
}

const RECENT_ORDER_LIMIT = 10;

function orderLines(messages: Messages, orders: ApiOrder[]): string {
  return orders
    .slice(0, RECENT_ORDER_LIMIT)
    .map((order, index) =>
      render(messages, "order_item_recent", {
        index: index + 1,
        order_id: order.orderId,
        date: order.recordedAt ?? "",
        cashback: formatVnd(messages, order.cashbackVnd ?? 0),
      }),
    )
    .join("\n");
}

function ordersWorded(messages: Messages, orders: ApiOrder[], ctx: WordingContext): WordedReply {
  if (orders.length === 0) return { key: "orders_empty", values: {} };
  return {
    key: "orders_summary",
    values: {
      count: orders.length,
      orders: orderLines(messages, orders),
      customer_id: ctx.customerId,
    },
  };
}

/** How an account is written for the customer: "VCB - 123 - LAN". */
function bankLine(bank: Pick<BankRead, "bankName" | "bankAccount" | "accountHolder">): string {
  return [bank.bankName, bank.bankAccount, bank.accountHolder]
    .filter((part): part is string => part !== null && part !== "")
    .join(" - ");
}

/** Which message-file key answers a reply, and with what values. */
export function wordingFor(
  messages: Messages,
  reply: Reply,
  ctx: WordingContext,
): WordedReply | null {
  switch (reply.kind) {
    case "silent":
      return null;
    case "link":
      return {
        key: "link_ready_no_estimate",
        values: {
          link: reply.affiliateUrl,
          rate: ctx.ratePercent,
          days: ctx.attributionDays,
          tax_clause: "",
        },
      };
    case "link_pending":
      return { key: "received", values: {} };
    case "unsupported_link":
      return { key: "link_failed", values: {} };
    case "orders":
      return ordersWorded(messages, reply.orders, ctx);
    case "account":
      return {
        key: "account_id",
        values: { customer_id: reply.customerCode ?? reply.customerId, zalo_id: reply.customerId },
      };
    case "password":
      return {
        key: "password_issued",
        values: {
          customer_id: reply.customerCode ?? reply.customerId,
          password: reply.password,
        },
      };
    case "password_failed":
      return { key: "password_failed", values: {} };
    case "bank_saved":
      return { key: "bank_saved", values: { name: bankLine(reply.details) } };
    case "bank_current":
      return reply.bank.hasBank
        ? { key: "bank_current", values: { name: bankLine(reply.bank) } }
        : { key: "need_bank", values: {} };
    case "bank_needs_details":
      return { key: "need_bank", values: {} };
    case "unknown_command":
      return {
        key: "unknown_command",
        values: { command: reply.command, commands: render(messages, "command_list") },
      };
  }
}

/** The finished sentence, or null when nothing should be sent. */
export function renderReply(
  messages: Messages,
  reply: Reply,
  ctx: WordingContext,
): string | null {
  const worded = wordingFor(messages, reply, ctx);
  return worded ? render(messages, worded.key, worded.values) : null;
}
