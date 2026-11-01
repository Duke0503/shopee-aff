/**
 * Saving a bank account from the Zalo private chat (AD-15, FR-10, M-7, INV-9; Story 6.9): the
 * details after `/stk`, or a reply (a quote) in the private chat that reads as bank details, go
 * to the server, which reads, matches and saves them; the reply names the bank and the last four
 * digits only. Details written in the group never leave the assistant: the group gets the pointer
 * to the private chat (the server's `private_only`, asked without the details). Details longer
 * than any real account are answered with the rule's message without asking the server. Neither
 * the details nor the number are ever logged; an error names the path and the status only.
 */
import { BANK_DETAILS_MAX_LENGTH, type AssistantBankReply } from "@cashback/contracts";

import type { InternalApi } from "./internal-api.adapter";
import type { ReplyMessage } from "./link-reply-text";
import { messageText, type MessageKey } from "./messages";
import type { IncomingMessage } from "./zalo.port";

const RULE_MESSAGES: Readonly<Record<Extract<AssistantBankReply, { kind: "invalid" }>["rule"], MessageKey>> = {
  format: "bank_rule_format",
  number: "bank_rule_number",
  holder: "bank_rule_holder",
  bank: "bank_rule_bank",
};

/** The message that answers one save; null sends nothing (the guest account, D5). */
export function bankReplyMessage(reply: AssistantBankReply): ReplyMessage | null {
  switch (reply.kind) {
    case "saved":
      return { key: "bank_saved", values: { bank: reply.bankName, lastFour: reply.lastFour } };
    case "choose_bank":
      return { key: "bank_choose", values: { banks: reply.banks.map((bank) => messageText("bank_choice_line", { bank })).join("\n") } };
    case "invalid":
      return { key: RULE_MESSAGES[reply.rule], values: {} };
    case "private_only":
      return { key: "command_private_only", values: {} };
    case "not_registered":
      return { key: "command_not_registered", values: {} };
    case "contact_admin":
      return { key: "command_contact_admin", values: {} };
    case "none":
    case "not_bank_details":
      return null;
  }
}

/** Six digits or more, spaces or dashes between them allowed: what an account number looks like. */
const ACCOUNT_DIGITS = /\d(?:[\s-]?\d){5,}/;

/**
 * A quoted reply worth asking the server about: an account-like run of digits and a word of
 * letters. The server then reads it as bank details only when it names a VietQR bank too;
 * anything else is answered as ordinary chat.
 */
export function looksLikeBankDetails(text: string): boolean {
  return ACCOUNT_DIGITS.test(text) && text.trim().split(/\s+/).some((w) => /^\p{L}{2,}$/u.test(w));
}

export interface BankSaveDeps {
  readonly api: Pick<InternalApi, "saveBank">;
  readonly send: (target: IncomingMessage["chat"], key: MessageKey, values?: Readonly<Record<string, string>>) => Promise<void>;
}

/**
 * Answers bank details sent in the private chat, in the pacer's turn; a new sender gets the
 * welcome first. False when a quoted reply was not bank details and nobody new was welcomed: the
 * caller answers it as any other message.
 */
export async function saveBankFromChat(deps: BankSaveDeps, message: IncomingMessage, details: string, displayName: string | null, quoted = false): Promise<boolean> {
  if (message.chat.kind !== "private") throw new Error("bank details are read only in the private chat");
  if (details.length > BANK_DETAILS_MAX_LENGTH) {
    if (quoted) return false;
    await deps.send(message.chat, "bank_rule_format");
    return true;
  }
  const answer = await deps.api.saveBank({ zaloUserId: message.senderId, displayName, chat: "private", details, ...(quoted ? { quoted } : {}) });
  if (answer.registered) await deps.send(message.chat, "welcome", { customerCode: answer.customerCode ?? "" });
  if (answer.reply.kind === "not_bank_details") return answer.registered;
  const reply = bankReplyMessage(answer.reply);
  if (reply !== null) await deps.send(message.chat, reply.key, reply.values);
  return true;
}
