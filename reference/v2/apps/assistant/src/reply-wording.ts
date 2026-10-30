import type { ApiBalance, ApiDeal, ApiOrder } from "@mmo/contracts";

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
const TOPDEAL_LIMIT = 10;

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

/** The balance totals, plus the one line that tells them what happens next. */
function balanceWorded(messages: Messages, balance: ApiBalance, hasBank: boolean): WordedReply {
  if (balance.approvedWaitingVnd === 0 && balance.stillWithShopVnd === 0 && balance.alreadyPaidVnd === 0) {
    return { key: "balance_empty", values: {} };
  }
  return {
    key: "balance_summary",
    values: {
      approved: formatVnd(messages, balance.approvedWaitingVnd),
      awaiting: formatVnd(messages, balance.stillWithShopVnd),
      paid: formatVnd(messages, balance.alreadyPaidVnd),
      status_line: render(messages, hasBank ? "balance_ready" : "balance_need_bank"),
    },
  };
}

/** The "hoàn tiền cao" list. It shows a name and a cashback, never a link. */
function topDealsWorded(messages: Messages, deals: ApiDeal[]): WordedReply {
  if (deals.length === 0) return { key: "topdeal_empty", values: {} };
  return {
    key: "topdeal_header",
    values: {
      deals: deals
        .slice(0, TOPDEAL_LIMIT)
        .map((deal, index) =>
          render(messages, "topdeal_item", {
            index: index + 1,
            name: deal.name,
            cashback: formatVnd(messages, deal.cashbackVnd),
          }),
        )
        .join("\n"),
    },
  };
}

/** Replies whose answer is one fixed message key and no values. */
const FIXED_KEYS: Record<string, string> = {
  link_pending: "received",
  unsupported_link: "link_failed",
  password_failed: "password_failed",
  bank_needs_details: "need_bank",
  bank_erased: "bank_deleted",
};

/** The policy numbers a fixed-key sentence may need. */
function staticValues(messages: Messages, ctx: WordingContext): Record<string, string | number> {
  return {
    rate: ctx.ratePercent,
    days: ctx.attributionDays,
    tax_clause: "",
    tax_clause_full: render(messages, "tax_clause_full", { rate: ctx.ratePercent }),
  };
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
    case "static":
      return { key: reply.key, values: staticValues(messages, ctx) };
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
        values: { customer_id: reply.customerCode ?? reply.customerId, password: reply.password },
      };
    case "bank_saved":
      return { key: "bank_saved", values: { name: bankLine(reply.details) } };
    case "bank_current":
      return reply.bank.hasBank
        ? { key: "bank_current", values: { name: bankLine(reply.bank) } }
        : { key: "need_bank", values: {} };
    case "balance":
      return balanceWorded(messages, reply.balance, reply.hasBank);
    case "topdeals":
      return topDealsWorded(messages, reply.deals);
    case "unknown_command":
      return {
        key: "unknown_command",
        values: { command: reply.command, commands: render(messages, "command_list") },
      };
    default:
      return { key: FIXED_KEYS[reply.kind] ?? reply.kind, values: {} };
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
