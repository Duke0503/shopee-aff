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
 *
 * `/matkhau` (Story 6.8, D21, INV-8) is refused in the group like the others. In the private chat
 * the customer is checked, the new password is drawn and hashed outside any transaction (argon2id
 * runs on the thread pool), and the hash is stored with every open session ended in one
 * transaction. The password is in the answer only; the log line names the reply kind.
 */
import { ASSISTANT_COMMAND_PATH, assistantCommandAnswerSchema, assistantCommandSchema, CHAT_ORDERS_MAX, PRIVATE_ONLY_COMMANDS, type AssistantCommand, type AssistantCommandReply } from "@cashback/contracts";
import { nettingPlan } from "@cashback/money";
import type { FastifyInstance } from "fastify";

import { bankAccountsOf, bankDisplayName, customerCodeOf, customerKeys, hashPassword, newCustomerPassword, resolveCustomer, setCustomerPassword } from "../modules/identity/index";
import { commandAudit } from "../modules/operations/index";
import { chatOrdersOf } from "../modules/orders/index";
import { getBalances } from "../modules/payouts/index";
import type { LedgerDb } from "../platform/db/ledger";
import { HttpError } from "../platform/http/error-envelope";
import { ASSISTANT_ROUTE } from "../platform/http/internal-token.guard";
import type { Registered } from "../modules/identity/index";
import { register, type AssistantChatRouteDeps } from "./assistant-chat.routes";

export type AssistantCommandRouteDeps = Pick<AssistantChatRouteDeps, "ledger" | "clock"> & {
  /** Draws a new password; tests pass a fixed one. */
  readonly newPassword?: () => string;
};

type CustomerCommand = Exclude<AssistantCommand["command"], "help" | "password">;

/** The customer a command is about, or the reply that ends it before any fact is read. */
function commandCustomer(db: LedgerDb, key: string): { readonly customerId: string; readonly customerCode: string } | AssistantCommandReply {
  const customer = resolveCustomer(db, key);
  if (customer === null) return { kind: "not_registered" };
  if (customer.role === "HOUSE") return { kind: "none" };
  const code = customerCodeOf(db, customer.customerId);
  if (code === null) return { kind: "contact_admin" };
  return { customerId: customer.customerId, customerCode: code };
}

const isReply = (found: ReturnType<typeof commandCustomer>): found is AssistantCommandReply => "kind" in found;

function balanceReply(db: LedgerDb, customerId: string): AssistantCommandReply {
  const [balance] = getBalances(db, [customerId]);
  const gross = balance?.gross ?? 0;
  const netting = nettingPlan(gross, [{ clawbackId: "open", open: balance?.deductedNext ?? 0 }]);
  return { kind: "balance", payable: balance?.payable ?? 0, waiting: balance?.waiting ?? 0, paid: balance?.paid ?? 0, deducted: netting.netted, owedAfter: netting.carriedForward };
}

/** What one command about a customer says for the record `key` resolves to. */
export function commandReplyOf(db: LedgerDb, command: CustomerCommand, key: string): AssistantCommandReply {
  const customer = commandCustomer(db, key);
  if (isReply(customer)) return customer;
  const id = customer.customerId;
  switch (command) {
    case "id":
      return { kind: "id", customerCode: customer.customerCode };
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

/** `/matkhau` in the private chat: a new password, its hash stored and every open session ended (D21). */
/** Who may get a password, from one read: an active customer (USER) with a code; anyone else is not. */
function passwordCustomer(db: LedgerDb, key: string): ReturnType<typeof commandCustomer> {
  const customer = resolveCustomer(db, key);
  if (customer === null) return { kind: "not_registered" };
  if (customer.role === "HOUSE") return { kind: "none" };
  const code = customerCodeOf(db, customer.customerId);
  if (customer.role !== "USER" || customer.status !== "ACTIVE" || code === null) return { kind: "contact_admin" };
  return { customerId: customer.customerId, customerCode: code };
}

async function passwordReply(deps: AssistantCommandRouteDeps, key: string): Promise<AssistantCommandReply> {
  const found = deps.ledger.tx((db) => passwordCustomer(db, key));
  if (isReply(found)) return found;
  const password = (deps.newPassword ?? newCustomerPassword)();
  const hash = await hashPassword(password);
  const actor = { kind: "customer", id: found.customerId } as const;
  // Disabled, merged or erased while the hash was made: the store refuses, and no password is shown.
  const stored = deps.ledger.tx((db) => setCustomerPassword(db, found.customerId, hash, { clock: deps.clock, by: commandAudit(db, deps.clock, actor) }));
  return stored === null ? { kind: "contact_admin" } : { kind: "password", customerCode: found.customerCode, password };
}

async function replyOf(deps: AssistantCommandRouteDeps, command: AssistantCommand["command"], key: string): Promise<AssistantCommandReply> {
  if (command === "help") return helpReply(deps.ledger, key);
  if (command === "password") return passwordReply(deps, key);
  return deps.ledger.tx((db) => commandReplyOf(db, command, key));
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
      const reply = await replyOf(deps, command, sender?.customerId ?? zaloUserId);
      request.log.info({ command, chat, reply: reply.kind }, "messaging.chat_command.answered");
      return answer(reply, sender);
    });
  };
}
