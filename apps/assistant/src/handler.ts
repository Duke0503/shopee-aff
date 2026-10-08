import type { ApiConvertResult, ApiOrder } from "@mmo/contracts";

import type { BankDetails } from "./bank-details";
import { handleCommand, type BankRead, type CommandDeps } from "./commands";
import { extractFirstUrl } from "./parse-message";
import { handlePasteLink } from "./paste-link";

/**
 * One incoming Zalo message, one reply decision. A pasted link wins over a
 * command; commands are answered; plain chat is left alone. It returns a
 * KIND, never a finished sentence — the wording is chosen where it is sent.
 */
export interface IncomingMessage {
  text: string;
  customerId: string;
  nowMs: number;
}

export interface HandlerDeps extends CommandDeps {
  convert: (url: string, customerId?: string) => Promise<ApiConvertResult>;
}

export type Reply =
  | { kind: "silent" }
  | { kind: "link"; affiliateUrl: string }
  | { kind: "link_pending"; requestId: string }
  | { kind: "unsupported_link" }
  | { kind: "orders"; orders: ApiOrder[] }
  | { kind: "account"; customerId: string; customerCode: string | null }
  | { kind: "password"; customerId: string; customerCode: string | null; password: string }
  | { kind: "password_failed" }
  | { kind: "bank_saved"; details: BankDetails }
  | { kind: "bank_current"; bank: BankRead }
  | { kind: "bank_needs_details" }
  | { kind: "unknown_command"; command: string };

export async function handleIncoming(
  message: IncomingMessage,
  deps: HandlerDeps,
): Promise<Reply> {
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

  const outcome = await handleCommand(message.text, message.customerId, deps);
  switch (outcome.kind) {
    case "not_a_command":
      return { kind: "silent" };
    case "orders":
      return { kind: "orders", orders: outcome.orders };
    case "account":
      return {
        kind: "account",
        customerId: outcome.customerId,
        customerCode: outcome.customerCode,
      };
    case "password":
      return {
        kind: "password",
        customerId: outcome.customerId,
        customerCode: outcome.customerCode,
        password: outcome.password,
      };
    case "password_failed":
      return { kind: "password_failed" };
    case "bank_saved":
      return { kind: "bank_saved", details: outcome.details };
    case "bank_current":
      return { kind: "bank_current", bank: outcome.bank };
    case "bank_needs_details":
      return { kind: "bank_needs_details" };
    default:
      return { kind: "unknown_command", command: outcome.command };
  }
}
