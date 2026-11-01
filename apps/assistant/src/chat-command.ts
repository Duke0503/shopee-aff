/**
 * The chat commands (AD-15, FR-15, FR-20, D11, D27; Story 6.7): `/id`, `/sodu`, `/donhang`, `/stk`
 * and `/help`, with the live system's other spellings. The server answers each with its facts
 * (`getBalances` for the balance, the status values of the latest orders, the bank name and last
 * four digits); every sentence comes from the message file by key, an order's state as its status
 * sentence (order-text.ts), and no reply names a payout date. `/sodu`, `/donhang` and `/stk` in
 * the group are refused by the server with the pointer to the private chat; the guest account
 * gets no reply (D5). A group reply tags the sender.
 * A private command from someone new registers them on the server; they get the welcome (which
 * carries their code) and then the answer, the welcome alone for `/id`. Each reply goes out in
 * the pacer's turn. `/stk` with details after it is answered like `/stk` for now: saving an
 * account from the chat is Story 6.9, and the details are never sent to the server or logged.
 */
import type { AssistantChat, AssistantChatOrder, AssistantCommandName, AssistantCommandReply } from "@cashback/contracts";

import type { InternalApi } from "./internal-api.adapter";
import { dongText, type ReplyMessage } from "./link-reply-text";
import { parseCommand } from "./message-parse";
import { messageText, type MessageKey } from "./messages";
import { orderStateText } from "./order-text";
import type { ChatTarget, IncomingMessage } from "./zalo.port";

export interface CommandDeps {
  readonly api: Pick<InternalApi, "command">;
  /** Sends one message by key in the pacer's turn; a tag is written in front of a group message. */
  readonly send: (target: ChatTarget, key: MessageKey, values?: Readonly<Record<string, string>>, tag?: { readonly userId: string; readonly name: string } | null) => Promise<void>;
}

/** Each spelling a person may type (without the slash), as the live assistant took them. */
export const COMMAND_SPELLINGS: Readonly<Record<AssistantCommandName, readonly string[]>> = {
  id: ["id", "ma"],
  balance: ["sodu"],
  orders: ["donhang", "don", "lichsu"],
  bank: ["stk", "bank", "tk"],
  help: ["help", "huongdan"],
};

/** The command a message is, or null for any other text (an unknown `/word` included). */
export function commandOf(text: string): AssistantCommandName | null {
  const parsed = parseCommand(text);
  if (parsed === null) return null;
  const found = Object.entries(COMMAND_SPELLINGS).find(([, spellings]) => spellings.includes(parsed.command));
  return found === undefined ? null : (found[0] as AssistantCommandName);
}

function orderLine(order: AssistantChatOrder): string | null {
  const state = orderStateText(order.status, order.rejectionReason);
  if (state === null) return null;
  const shown = order.cashback !== null && (order.status === "APPROVED" || order.status === "PAID");
  return shown ? messageText("command_orders_line_amount", { orderId: order.orderId, state, cashback: dongText(order.cashback) }) : messageText("command_orders_line", { orderId: order.orderId, state });
}

/**
 * The balance: the payable, with what the open clawbacks took from it when they took anything,
 * and what they still owe after the next payout when that is above 0.
 */
function balanceMessage(reply: Extract<AssistantCommandReply, { kind: "balance" }>): ReplyMessage {
  const payable = dongText(reply.payable);
  const lines = [reply.deducted > 0 ? messageText("balance_line_payable_deducted", { payable, deducted: dongText(reply.deducted) }) : messageText("balance_line_payable", { payable })];
  if (reply.owedAfter > 0) lines.push(messageText("balance_line_owed", { owed: dongText(reply.owedAfter) }));
  return { key: "command_balance", values: { payableLines: lines.join("\n"), waiting: dongText(reply.waiting), paid: dongText(reply.paid) } };
}

/** The message that answers one command reply; null sends nothing (the guest account, D5). */
export function commandReplyMessage(reply: AssistantCommandReply): ReplyMessage | null {
  switch (reply.kind) {
    case "id":
      return { key: "command_id", values: { customerCode: reply.customerCode } };
    case "balance":
      return balanceMessage(reply);
    case "orders": {
      const lines = reply.orders.flatMap((o) => orderLine(o) ?? []);
      return lines.length === 0 ? { key: "command_orders_none", values: {} } : { key: "command_orders", values: { orders: lines.join("\n") } };
    }
    case "bank": {
      if (reply.bank === null) return { key: "command_bank_none", values: {} };
      const values = { bank: reply.bank.bankName ?? messageText("bank_unnamed"), lastFour: reply.bank.lastFour };
      return { key: reply.bank.held ? "command_bank_held" : "command_bank_saved", values };
    }
    case "help":
      return { key: "command_help", values: {} };
    case "private_only":
      return { key: "command_private_only", values: {} };
    case "not_registered":
      return { key: "command_not_registered", values: {} };
    case "contact_admin":
      return { key: "command_contact_admin", values: {} };
    case "none":
      return null;
  }
}

/** Answers one command message through the server, in the pacer's turn; `displayName` as the chat reply cut it. */
export async function answerCommand(deps: CommandDeps, message: IncomingMessage, command: AssistantCommandName, displayName: string | null): Promise<void> {
  const chat: AssistantChat = message.chat.kind === "group" ? "group" : "private";
  const tag = chat === "group" && displayName !== null ? { userId: message.senderId, name: displayName } : null;
  const answer = await deps.api.command({ zaloUserId: message.senderId, displayName, chat, command });
  if (answer.registered) {
    await deps.send(message.chat, "welcome", { customerCode: answer.customerCode ?? "" });
    if (command === "id") return;
  }
  const reply = commandReplyMessage(answer.reply);
  if (reply !== null) await deps.send(message.chat, reply.key, reply.values, tag);
}
