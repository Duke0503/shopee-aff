/**
 * The chat commands the Zalo assistant asks the server about (AD-6, AD-10, AD-15, FR-15, FR-20,
 * D11, D27; Story 6.7), on the internal listener only with `X-Assistant-Token`:
 *
 *   POST /internal/assistant/commands   one command a person sent, answered with its facts
 *
 * A private message registers its sender first, as any private message does (D10); in the group
 * a command registers no one (D25), and a member the server does not know is told how to get a
 * code. `/donhang` and `/stk` are answered only in the private chat: in the group the answer is
 * `private_only` and carries no order and no bank fact; so does `/sodu` (owner decision, Sprint 27
 * review). The guest account gets `none` (no reply, D5); a record without a customer code gets
 * `contact_admin`. The balance is `getBalances` (D27), with what the next payout nets of the open
 * clawbacks and what they still owe after it computed in packages/money; an
 * order's state is its status value, which the assistant writes as the status sentence; a bank
 * account is its bank name and last four digits only, never the number. Amounts are whole dong.
 */
import { z } from "zod";

import { ASSISTANT_CHATS } from "./assistant-chat.schema";

export const ASSISTANT_COMMAND_PATH = "/internal/assistant/commands";

/** What a person can ask: `/id`, `/sodu`, `/donhang`, `/stk`, `/help`. */
export const ASSISTANT_COMMANDS = ["id", "balance", "orders", "bank", "help"] as const;
export type AssistantCommandName = (typeof ASSISTANT_COMMANDS)[number];

/** The commands answered only in the private chat. */
export const PRIVATE_ONLY_COMMANDS: readonly AssistantCommandName[] = ["balance", "orders", "bank"];

/** The most recent orders `/donhang` lists. */
export const CHAT_ORDERS_MAX = 10;

const zaloUserId = z.string().regex(/^[A-Za-z0-9]{1,40}$/);
const displayName = z.string().trim().max(120).nullable().optional();
const customerCode = z.string().regex(/^DP\d{5,}$/);
const dong = z.number().int().min(0);

export const assistantCommandSchema = z.strictObject({ zaloUserId, displayName, chat: z.enum(ASSISTANT_CHATS), command: z.enum(ASSISTANT_COMMANDS) });
export type AssistantCommand = z.infer<typeof assistantCommandSchema>;

const chatOrder = z.object({
  orderId: z.string().min(1).max(64),
  /** An order status value of the status registry. */
  status: z.string().regex(/^[A-Z_]{1,40}$/),
  /** The stored cashback, once approved; null before. */
  cashback: dong.nullable(),
  /** The cancel reason code of a rejected order (`order_cancelled`), or null. */
  rejectionReason: z.string().max(64).nullable(),
});
export type AssistantChatOrder = z.infer<typeof chatOrder>;

export const assistantCommandReplySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("id"), customerCode }),
  z.object({
    kind: z.literal("balance"),
    payable: dong,
    waiting: dong,
    paid: dong,
    /** What the open clawbacks take from the gross at the next payout: min(gross, open). */
    deducted: dong,
    /** What the open clawbacks still owe beyond that, carried to a later payout. */
    owedAfter: dong,
  }),
  z.object({ kind: z.literal("orders"), orders: z.array(chatOrder).max(CHAT_ORDERS_MAX) }),
  z.object({
    kind: z.literal("bank"),
    bank: z.object({ bankName: z.string().max(120).nullable(), lastFour: z.string().regex(/^[A-Za-z0-9]{1,4}$/), held: z.boolean() }).nullable(),
  }),
  z.object({ kind: z.literal("help") }),
  /** `/sodu`, `/donhang` or `/stk` in the group: refused, with the pointer to the private chat. */
  z.object({ kind: z.literal("private_only") }),
  /** A group member the server does not know. */
  z.object({ kind: z.literal("not_registered") }),
  /** A known record without a customer code (a staff record): the person is asked to write to an admin. */
  z.object({ kind: z.literal("contact_admin") }),
  /** The guest account (HOUSE): nothing is sent (D5). */
  z.object({ kind: z.literal("none") }),
]);
export type AssistantCommandReply = z.infer<typeof assistantCommandReplySchema>;

/** The reply, and whether this message registered its sender (a private message from someone new). */
export const assistantCommandAnswerSchema = z.object({ registered: z.boolean(), customerCode: customerCode.nullable(), reply: assistantCommandReplySchema });
export type AssistantCommandAnswer = z.infer<typeof assistantCommandAnswerSchema>;
