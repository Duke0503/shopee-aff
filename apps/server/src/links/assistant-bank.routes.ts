/**
 * The bank account route of the Zalo chat (AD-15, AD-17, AD-23, FR-10, M-7, INV-5, INV-9;
 * Story 6.9), on the internal listener only, behind `X-Assistant-Token`:
 *
 *   POST /internal/assistant/bank-accounts   "/stk <bank> <number> <holder>" from one sender
 *
 * In the group the answer is `private_only` before the details are read, and nothing is stored.
 * In the private chat the sender is registered first, like any private message (D10); the guest
 * account gets no reply (D5), a record without a customer code or a disabled one is sent to an
 * admin. A quoted reply that reads as no bank and number is `not_bank_details`, answered by the
 * assistant as ordinary chat. The details are read by identity (`readBankDetails`); a broken rule or a bank name that
 * matches several VietQR banks saves nothing. A save is one transaction with its audit entry and,
 * for a change, the change message (`saveChatBankAccount`). Without a FINGERPRINT_KEY of 32
 * characters or more nothing can be saved and the customer is sent to an admin. The answer and the
 * log line carry the bank's short name and the last four digits at most; the details are never
 * logged.
 */
import { ASSISTANT_BANK_PATH, assistantBankAnswerSchema, assistantBankSaveSchema, BANK_CHOICES_MAX, type AssistantBankReply } from "@cashback/contracts";
import type { FastifyInstance } from "fastify";

import { customerCodeOf, readBankDetails, resolveCustomer, saveChatBankAccount, type Registered } from "../modules/identity/index";
import { outboxFor } from "../modules/messaging/index";
import { commandAudit } from "../modules/operations/index";
import type { LedgerDb } from "../platform/db/ledger";
import { HttpError } from "../platform/http/error-envelope";
import { ASSISTANT_ROUTE } from "../platform/http/internal-token.guard";
import { register, type AssistantChatRouteDeps } from "./assistant-chat.routes";

export const FINGERPRINT_KEY_MIN = 32;

export type AssistantBankRouteDeps = Pick<AssistantChatRouteDeps, "ledger" | "clock"> & {
  /** FINGERPRINT_KEY; null when the config has none. */
  readonly fingerprintKey: string | null;
};

/** Reads and saves the details for the customer `key` resolves to, in the caller's transaction. */
export function bankReplyOf(db: LedgerDb, deps: AssistantBankRouteDeps, key: string, details: string, quoted = false): AssistantBankReply {
  const customer = resolveCustomer(db, key);
  if (customer === null) return { kind: "not_registered" };
  if (customer.role === "HOUSE") return { kind: "none" };
  if (customer.role !== "USER" || customer.status !== "ACTIVE" || customerCodeOf(db, customer.customerId) === null) return { kind: "contact_admin" };
  const read = readBankDetails(details);
  // A quoted reply is bank details only when a bank and a number were read; the rest is ordinary chat.
  if (quoted && read.kind === "invalid") return { kind: "not_bank_details" };
  if (read.kind === "invalid") return { kind: "invalid", rule: read.rule };
  if (read.kind === "choose_bank") return { kind: "choose_bank", banks: read.banks.slice(0, BANK_CHOICES_MAX).map((b) => b.shortName) };
  const fingerprintKey = deps.fingerprintKey;
  if (fingerprintKey === null || fingerprintKey.length < FINGERPRINT_KEY_MIN) return { kind: "contact_admin" };
  const actor = { kind: "customer", id: customer.customerId } as const;
  const by = commandAudit(db, deps.clock, actor);
  const saved = saveChatBankAccount(db, { customerId: customer.customerId, bank: read.bank, accountNumber: read.accountNumber, holderName: read.holderName }, { clock: deps.clock, fingerprintKey: fingerprintKey, by, outbox: outboxFor(db, deps.clock, by) });
  return { kind: "saved", bankName: saved.bankName, lastFour: saved.lastFour, changed: saved.result === "changed" };
}

export function assistantBankRoutes(deps: AssistantBankRouteDeps): (app: FastifyInstance) => void {
  return (app) => {
    app.post(ASSISTANT_BANK_PATH, { config: ASSISTANT_ROUTE }, async (request) => {
      const body = assistantBankSaveSchema.safeParse(request.body);
      if (!body.success) throw new HttpError("invalid_request", "error.invalid_request");
      const { zaloUserId, chat, details, quoted } = body.data;
      const answer = (reply: AssistantBankReply, registered: Registered | null) => assistantBankAnswerSchema.parse({ registered: registered?.created ?? false, customerCode: registered?.customerCode ?? null, reply });
      if (chat === "group") {
        request.log.info({ chat, reply: "private_only" }, "identity.chat_bank.answered");
        return answer({ kind: "private_only" }, null);
      }
      const sender = register(deps, request.log, zaloUserId, body.data.displayName ?? null, "private_message");
      const reply = deps.ledger.tx((db) => bankReplyOf(db, deps, sender.customerId, details, quoted === true));
      request.log.info({ chat, reply: reply.kind, ...(reply.kind === "invalid" ? { rule: reply.rule } : {}) }, "identity.chat_bank.answered");
      return answer(reply, sender);
    });
  };
}
