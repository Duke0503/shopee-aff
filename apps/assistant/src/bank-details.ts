import { BANK_COMMANDS } from "./commands";
import { parseCommand } from "./parse-message";

/**
 * `/bank <bank> <account> [holder]` — the customer setting their payout bank
 * account from chat. The assistant only parses and forwards; whether the bank
 * can be matched to a NAPAS BIN is the server's decision.
 */
export interface BankDetails {
  bankName: string;
  bankAccount: string;
  accountHolder: string;
}

export interface BankDeps {
  saveBank: (customerId: string, details: BankDetails) => Promise<void>;
}

export type BankOutcome =
  | { kind: "not_a_command" }
  | { kind: "need_details" }
  | { kind: "saved" }
  | { kind: "bank_not_matched" };

export async function handleBankDetails(
  text: string,
  customerId: string,
  deps: BankDeps,
): Promise<BankOutcome> {
  const parsed = parseCommand(text);
  if (!parsed || !BANK_COMMANDS.has(parsed.command)) return { kind: "not_a_command" };

  const [bankName, bankAccount, ...holderParts] = parsed.args;
  if (!bankName || !bankAccount) return { kind: "need_details" };

  try {
    await deps.saveBank(customerId, {
      bankName,
      bankAccount,
      accountHolder: holderParts.join(" "),
    });
    return { kind: "saved" };
  } catch {
    return { kind: "bank_not_matched" };
  }
}
