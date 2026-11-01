/**
 * The assistant's chat command route (AD-6, AD-10, AD-15, FR-15, FR-20, D5, D10, D11, D25, D27;
 * Story 6.7), on the internal listener only, behind `X-Assistant-Token`:
 *
 *   POST /internal/assistant/commands   `/id`, `/sodu`, `/donhang`, `/stk` or `/help` from one sender
 *
 * A private message registers its sender first (`register`, the chat routes' own), so a new person
 * asking `/id` gets a code like any first message. In the group nobody is registered (D25): a
 * member the server does not know gets `not_registered`. `/sodu`, `/donhang` and `/stk` in the
 * group are refused before anything is read, so the answer holds no money, order or bank fact.
 * `/help` needs no customer. The guest account (HOUSE) gets no reply at all (D5); a known record
 * without a customer code (a staff record) is asked to write to an admin, never told to register
 * again. The balance is `getBalances` itself (D27), with the next payout's netting of the open
 * clawbacks from packages/money (`nettingPlan`, the confirm's own rule); the orders are the latest
 * under the customer's ids, aliases included; the bank account is its bank name and last four
 * digits only (SECURITY_MODEL.md). The registration commits in its own transaction first.
 */
import { ASSISTANT_COMMAND_PATH, assistantCommandAnswerSchema, assistantCommandSchema, CHAT_ORDERS_MAX, PRIVATE_ONLY_COMMANDS, type AssistantCommand, type AssistantCommandReply } from "@cashback/contracts";
import { nettingPlan } from "@cashback/money";
import type { FastifyInstance } from "fastify";

import { bankAccountsOf, bankDisplayName, customerCodeOf, customerKeys, resolveCustomer } from "../modules/identity/index";
import { chatOrdersOf } from "../modules/orders/index";
import { getBalances } from "../modules/payouts/index";
import type { LedgerDb } from "../platform/db/ledger";
import { HttpError } from "../platform/http/error-envelope";
import { ASSISTANT_ROUTE } from "../platform/http/internal-token.guard";
import type { Registered } from "../modules/identity/index";
import { register, type AssistantChatRouteDeps } from "./assistant-chat.routes";

export type AssistantCommandRouteDeps = Pick<AssistantChatRouteDeps, "ledger" | "clock">;

type CustomerCommand = Exclude<AssistantCommand["command"], "help">;

function balanceReply(db: LedgerDb, customerId: string): AssistantCommandReply {
  const [balance] = getBalances(db, [customerId]);
  const gross = balance?.gross ?? 0;
  const netting = nettingPlan(gross, [{ clawbackId: "open", open: balance?.deductedNext ?? 0 }]);
  return { kind: "balance", payable: balance?.payable ?? 0, waiting: balance?.waiting ?? 0, paid: balance?.paid ?? 0, deducted: netting.netted, owedAfter: netting.carriedForward };
}

/** What one command about a customer says for the record `key` resolves to. */
export function commandReplyOf(db: LedgerDb, command: CustomerCommand, key: string): AssistantCommandReply {
  const customer = resolveCustomer(db, key);
  if (customer === null) return { kind: "not_registered" };
  if (customer.role === "HOUSE") return { kind: "none" };
  const code = customerCodeOf(db, customer.customerId);
  if (code === null) return { kind: "contact_admin" };
  const id = customer.customerId;
  switch (command) {
    case "id":
      return { kind: "id", customerCode: code };
    case "balance":
      return balanceReply(db, id);
    case "orders":
      return { kind: "orders", orders: chatOrdersOf(db, customerKeys(db, id)?.keys ?? [id], CHAT_ORDERS_MAX) };
    case "bank": {
      const bank = bankAccountsOf(db, [id]).get(id);
      return { kind: "bank", bank: bank === undefined ? null : { bankName: bankDisplayName(bank), lastFour: bank.lastFour, held: bank.held } };
    }
  }
}

/** `/help` needs no customer; only the guest account is left unanswered (D5). */
function helpReply(ledger: AssistantCommandRouteDeps["ledger"], key: string): AssistantCommandReply {
  return ledger.tx((db) => (resolveCustomer(db, key)?.role === "HOUSE" ? { kind: "none" } : { kind: "help" }));
}

export function assistantCommandRoutes(deps: AssistantCommandRouteDeps): (app: FastifyInstance) => void {
  return (app) => {
    app.post(ASSISTANT_COMMAND_PATH, { config: ASSISTANT_ROUTE }, async (request) => {
      const body = assistantCommandSchema.safeParse(request.body);
      if (!body.success) throw new HttpError("invalid_request", "error.invalid_request");
      const { zaloUserId, chat, command } = body.data;
      const answer = (reply: AssistantCommandReply, registered: Registered | null) =>
        assistantCommandAnswerSchema.parse({ registered: registered?.created ?? false, customerCode: registered?.customerCode ?? null, reply });
      if (chat === "group" && PRIVATE_ONLY_COMMANDS.includes(command)) return answer({ kind: "private_only" }, null);
      const sender = chat === "private" ? register(deps, request.log, zaloUserId, body.data.displayName ?? null, "private_message") : null;
      const reply = command === "help" ? helpReply(deps.ledger, sender?.customerId ?? zaloUserId) : deps.ledger.tx((db) => commandReplyOf(db, command, sender?.customerId ?? zaloUserId));
      request.log.info({ command, chat, reply: reply.kind }, "messaging.chat_command.answered");
      return answer(reply, sender);
    });
  };
}
