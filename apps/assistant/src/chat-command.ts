/**
 * The chat commands (AD-15, FR-15, FR-20, D11, D27; Story 6.7): `/id`, `/sodu`, `/donhang`, `/stk`
 * and `/help`, with the live system's other spellings, plus the live bot's `/web`, `/chinhsach` and
 * `/ping`, which say the same thing to everyone and are answered here without the server. The server
 * answers each customer command with its facts (`getBalances` for the balance, the latest orders
 * with today's marked, the bank name and last four digits); every sentence comes from the message
 * file by key in the live bot's words (owner requirement 2026-11-02), and no reply names a payout
 * date. `/sodu`, `/donhang`, `/stk` and `/matkhau` in the group are refused by the server; the group
 * gets the live bot's pointer to the private chat. `/id` in the group gets that pointer too and the
 * code goes to the person's private chat, and `/matkhau` there sends the live nudge privately, as the
 * live bot did. The guest account gets no reply (D5). A group reply tags the sender.
 * A private command from someone new registers them on the server; they get the welcome (which
 * carries their code) and then the answer, the welcome alone for `/id`. Each reply goes out in
 * the pacer's turn. `/stk` with details after it saves the account in the private chat
 * (bank-reply.ts, Story 6.9); in the group it is answered like `/stk`, with the pointer to the
 * private chat, and the details are never sent to the server or logged. `/matkhau` (Story 6.8)
 * answers the new password once in the private chat.
 */
import { INSTANT_PATTERN, vnDateOf, type Clock, type Instant } from "@cashback/core";
import type { AssistantChat, AssistantChatOrder, AssistantCommandName, AssistantCommandReply } from "@cashback/contracts";

import { saveBankFromChat } from "./bank-reply";
import type { InternalApi } from "./internal-api.adapter";
import { dongText, type ReplyMessage } from "./link-reply-text";
import { parseCommand } from "./message-parse";
import { messageText, type MessageKey, type MessageValues } from "./messages";
import type { ChatTarget, IncomingMessage } from "./zalo.port";

export interface CommandDeps {
  readonly api: Pick<InternalApi, "command" | "saveBank">;
  readonly clock: Clock;
  /** Sends one message by key in the pacer's turn; a tag is written in front of a group message. */
  readonly send: (target: ChatTarget, key: MessageKey, values?: MessageValues, tag?: { readonly userId: string; readonly name: string } | null) => Promise<void>;
}

/** Each spelling a person may type (without the slash), as the live assistant took them. */
export const COMMAND_SPELLINGS: Readonly<Record<AssistantCommandName, readonly string[]>> = {
  id: ["id", "ma"],
  balance: ["sodu"],
  orders: ["donhang", "don", "lichsu"],
  bank: ["stk", "bank", "tk"],
  help: ["help", "huongdan"],
  password: ["matkhau", "pass", "password"],
};

/** The live bot's commands that say the same to everyone: answered without the server. */
export const STATIC_COMMANDS: Readonly<Record<string, MessageKey>> = {
  web: "command_web",
  chinhsach: "command_policy",
  ping: "command_ping",
};

/** The command a message is, or null for any other text (an unknown `/word` included). */
export function commandOf(text: string): AssistantCommandName | null {
  const parsed = parseCommand(text);
  if (parsed === null) return null;
  const found = Object.entries(COMMAND_SPELLINGS).find(([, spellings]) => spellings.includes(parsed.command));
  return found === undefined ? null : (found[0] as AssistantCommandName);
}

/** The message key of a static command (`/web`), or null. */
export function staticCommandOf(text: string): MessageKey | null {
  const parsed = parseCommand(text);
  return parsed !== null && Object.hasOwn(STATIC_COMMANDS, parsed.command) ? (STATIC_COMMANDS[parsed.command] ?? null) : null;
}

const RECENT_ORDERS = 5;

/** `2026-10-30` as the live bot wrote dates: `30/10/2026`, or `30/10` without the year. */
function dayText(vnDate: string, withYear: boolean): string {
  const [year, month, day] = vnDate.split("-");
  return withYear ? `${day}/${month}/${year}` : `${day}/${month}`;
}

const orderAmount = (o: AssistantChatOrder): number => o.amount ?? o.cashback ?? 0;

const orderDay = (o: AssistantChatOrder): string =>
  o.recordedAt !== null && o.recordedAt !== undefined && INSTANT_PATTERN.test(o.recordedAt) ? dayText(vnDateOf(o.recordedAt as Instant), false) : messageText("value_missing");

/** `/donhang` as the live order_history wrote it: today's orders and their total, else the latest five. */
function ordersMessage(reply: Extract<AssistantCommandReply, { kind: "orders" }>, now: Instant): ReplyMessage {
  const date = dayText(vnDateOf(now), true);
  if (reply.orders.length === 0) return { key: "command_orders_none", values: { date } };
  const today = reply.orders.filter((o) => o.today === true);
  if (today.length > 0) {
    const orders = today.map((o, i) => messageText("command_orders_line_today", { index: i + 1, orderId: o.orderId, cashback: dongText(orderAmount(o)) })).join("\n");
    return { key: "command_orders_today", values: { date, orders, total: dongText(reply.todayTotal ?? 0) } };
  }
  const recent = reply.orders.slice(0, RECENT_ORDERS);
  const orders = recent.map((o, i) => messageText("command_orders_line_recent", { index: i + 1, orderId: o.orderId, date: orderDay(o), cashback: dongText(orderAmount(o)) })).join("\n");
  return { key: "command_orders_recent", values: { date, count: recent.length, orders } };
}

/** The balance as the live `/sodu` showed it, with the clawback netting on the payable line when any. */
function balanceMessage(reply: Extract<AssistantCommandReply, { kind: "balance" }>, name: string): ReplyMessage {
  const payable = dongText(reply.payable);
  const payableLine = reply.deducted > 0 ? messageText("balance_line_payable_deducted", { payable, deducted: dongText(reply.deducted) }) : messageText("balance_line_payable", { payable });
  const owedLine = reply.owedAfter > 0 ? messageText("balance_line_owed", { owed: dongText(reply.owedAfter) }) : "";
  const bank = reply.bank ?? null;
  const bankStatus = bank === null ? messageText("balance_bank_none") : messageText(bank.held ? "balance_bank_held" : "balance_bank_set", { bank: bank.bankName ?? messageText("bank_unnamed"), lastFour: bank.lastFour });
  return {
    key: "command_balance",
    values: { name, customerCode: reply.customerCode ?? messageText("value_missing"), payableLine, waiting: dongText(reply.waiting), paid: dongText(reply.paid), owedLine, bankStatus },
  };
}

/**
 * The message that answers one command reply; null sends nothing (the guest account, D5). `name`
 * is the sender's Zalo name, `now` dates the orders list.
 */
export function commandReplyMessage(reply: AssistantCommandReply, context: { readonly name: string; readonly now: Instant; readonly command?: AssistantCommandName }): ReplyMessage | null {
  switch (reply.kind) {
    case "id":
      return { key: "command_id", values: { name: context.name, customerCode: reply.customerCode } };
    case "balance":
      return balanceMessage(reply, context.name);
    case "orders":
      return ordersMessage(reply, context.now);
    case "bank": {
      if (reply.bank === null) return { key: "command_bank_none", values: {} };
      const values = { name: context.name, bank: reply.bank.bankName ?? messageText("bank_unnamed"), lastFour: reply.bank.lastFour };
      return { key: reply.bank.held ? "command_bank_held" : "command_bank_saved", values };
    }
    case "help":
      return { key: "command_help", values: {} };
    case "password":
      return { key: "command_password", values: { password: reply.password, customerCode: reply.customerCode } };
    case "private_only":
      return { key: context.command === "orders" ? "command_orders_private_only" : "command_private_only", values: {} };
    case "not_registered":
      return { key: "command_not_registered", values: {} };
    case "contact_admin":
      return { key: "command_contact_admin", values: {} };
    case "none":
      return null;
  }
}

/** The live bot's private message after `/id` or `/matkhau` in the group, or null for none. */
function privateFollowUp(command: AssistantCommandName, reply: AssistantCommandReply, name: string): ReplyMessage | null {
  if (command === "id" && reply.kind === "id") return { key: "command_id_from_group", values: { name, customerCode: reply.customerCode } };
  if (command === "password" && reply.kind === "private_only") return { key: "command_password_from_group", values: { name } };
  return null;
}

/** Answers one command message through the server, in the pacer's turn; `displayName` as the chat reply cut it. */
export async function answerCommand(deps: CommandDeps, message: IncomingMessage, command: AssistantCommandName, displayName: string | null): Promise<void> {
  const chat: AssistantChat = message.chat.kind === "group" ? "group" : "private";
  const tag = chat === "group" && displayName !== null ? { userId: message.senderId, name: displayName } : null;
  const details = command === "bank" ? (parseCommand(message.text)?.args ?? []).join(" ") : "";
  if (chat === "private" && details !== "") return void (await saveBankFromChat(deps, message, details, displayName));
  const answer = await deps.api.command({ zaloUserId: message.senderId, displayName, chat, command });
  const name = displayName ?? messageText("sender_fallback_name");
  if (answer.registered) {
    await deps.send(message.chat, "welcome", { name, customerCode: answer.customerCode ?? "" });
    if (command === "id") return;
  }
  if (chat === "group") {
    const followUp = privateFollowUp(command, answer.reply, name);
    if (followUp !== null) {
      await deps.send(message.chat, "command_private_only", {}, tag);
      return deps.send({ kind: "private", userId: message.senderId }, followUp.key, followUp.values);
    }
  }
  const reply = commandReplyMessage(answer.reply, { name, now: deps.clock.now(), command });
  if (reply !== null) await deps.send(message.chat, reply.key, reply.values, tag);
}

/** Answers `/web`, `/chinhsach` or `/ping` as the live bot did; a group reply tags the sender, except `/ping`. */
export async function answerStaticCommand(deps: Pick<CommandDeps, "send">, message: IncomingMessage, key: MessageKey, displayName: string | null): Promise<void> {
  const tag = message.chat.kind === "group" && displayName !== null && key !== "command_ping" ? { userId: message.senderId, name: displayName } : null;
  await deps.send(message.chat, key, key === "command_ping" ? { groupName: messageText("group_default_name") } : {}, tag);
}

