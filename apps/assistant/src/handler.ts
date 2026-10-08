import type { ApiConvertResult, ApiOrder } from "@mmo/contracts";

import { handleBankDetails, type BankDetails } from "./bank-details";
import { BANK_COMMANDS, handleCommand } from "./commands";
import { extractFirstUrl, parseCommand } from "./parse-message";
import { handlePasteLink } from "./paste-link";

/**
 * One incoming Zalo message, one reply decision. This composes the pieces —
 * a pasted link wins over a command, commands are answered, plain chat is
 * left alone — and returns a KIND, never a finished sentence.
 */
export interface IncomingMessage {
  text: string;
  customerId: string;
  nowMs: number;
}

export interface HandlerDeps {
  convert: (url: string, customerId?: string) => Promise<ApiConvertResult>;
  myOrders: () => Promise<ApiOrder[]>;
  saveBank: (customerId: string, details: BankDetails) => Promise<void>;
}

export type Reply =
  | { kind: "silent" }
  | { kind: "link"; affiliateUrl: string }
  | { kind: "link_pending"; requestId: string }
  | { kind: "unsupported_link" }
  | { kind: "orders"; orders: ApiOrder[] }
  | { kind: "bank_prompt" }
  | { kind: "bank_saved" }
  | { kind: "bank_needs_details" }
  | { kind: "bank_unmatched" }
  | { kind: "unknown_command"; command: string };

export async function handleIncoming(message: IncomingMessage, deps: HandlerDeps): Promise<Reply> {
  if (extractFirstUrl(message.text)) {
    const outcome = await handlePasteLink(message.text, message.customerId, {
      convert: deps.convert,
    });
    switch (outcome.kind) {
      case "ready":
        return { kind: "link", affiliateUrl: outcome.affiliateUrl };
      case "pending":
        return { kind: "link_pending", requestId: outcome.requestId };
      case "unsupported":
        return { kind: "unsupported_link" };
      default:
        return { kind: "silent" };
    }
  }

  const parsed = parseCommand(message.text);
  if (!parsed) return { kind: "silent" };

  if (parsed.command === "donhang" || parsed.command === "orders") {
    const outcome = await handleCommand(message.text, { myOrders: deps.myOrders });
    return outcome.kind === "orders" ? { kind: "orders", orders: outcome.orders } : { kind: "silent" };
  }

  if (BANK_COMMANDS.has(parsed.command)) {
    const outcome = await handleBankDetails(message.text, message.customerId, {
      saveBank: deps.saveBank,
    });
    switch (outcome.kind) {
      case "saved":
        return { kind: "bank_saved" };
      case "need_details":
        return { kind: "bank_needs_details" };
      case "bank_not_matched":
        return { kind: "bank_unmatched" };
      default:
        return { kind: "bank_prompt" };
    }
  }

  return { kind: "unknown_command", command: parsed.command };
}
