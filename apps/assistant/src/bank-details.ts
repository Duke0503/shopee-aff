import { BANK_COMMANDS } from "./command-names";
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
  | { kind: "saved"; details: BankDetails }
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

  const details: BankDetails = {
    bankName,
    bankAccount,
    accountHolder: holderParts.join(" "),
  };
  try {
    await deps.saveBank(customerId, details);
    return { kind: "saved", details };
  } catch {
    return { kind: "bank_not_matched" };
  }
}
