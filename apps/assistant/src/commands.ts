import type { ApiOrder } from "@mmo/contracts";

import { handleBankDetails, type BankDetails } from "./bank-details";
import { BANK_COMMANDS, ID_COMMANDS, ORDERS_COMMANDS, PASSWORD_COMMANDS } from "./command-names";
import { parseCommand } from "./parse-message";

export { BANK_COMMANDS, ID_COMMANDS, ORDERS_COMMANDS, PASSWORD_COMMANDS };

export interface CustomerIdentity {
  customerId: string;
  customerCode: string | null;
}

export interface BankRead {
  hasBank: boolean;
  bankName: string | null;
  bankAccount: string | null;
  accountHolder: string | null;
}

export interface CommandDeps {
  myOrders: (customerId: string) => Promise<ApiOrder[]>;
  resolveCustomer: (customerId: string) => Promise<CustomerIdentity>;
  issuePassword: (customerId: string) => Promise<{ customerCode: string | null; password: string }>;
  bankDetails: (customerId: string) => Promise<BankRead>;
  saveBank: (customerId: string, details: BankDetails) => Promise<void>;
}

export type CommandOutcome =
  | { kind: "not_a_command" }
  | { kind: "orders"; orders: ApiOrder[] }
  | { kind: "account"; customerId: string; customerCode: string | null }
  | { kind: "password"; customerId: string; customerCode: string | null; password: string }
  | { kind: "password_failed" }
  | { kind: "bank_saved"; details: BankDetails }
  | { kind: "bank_current"; bank: BankRead }
  | { kind: "bank_needs_details" }
  | { kind: "unknown"; command: string };

async function orders(customerId: string, deps: CommandDeps): Promise<CommandOutcome> {
  const list = await deps.myOrders(customerId).catch(() => []);
  return { kind: "orders", orders: list };
}

async function account(customerId: string, deps: CommandDeps): Promise<CommandOutcome> {
  const customer = await deps.resolveCustomer(customerId).catch(() => null);
  if (!customer) return { kind: "unknown", command: "id" };
  return { kind: "account", customerId: customer.customerId, customerCode: customer.customerCode };
}

async function password(customerId: string, deps: CommandDeps): Promise<CommandOutcome> {
  const issued = await deps.issuePassword(customerId).catch(() => null);
  if (!issued) return { kind: "password_failed" };
  return {
    kind: "password",
    customerId,
    customerCode: issued.customerCode,
    password: issued.password,
  };
}

/** `/bank` alone shows the saved account; `/bank <bank> <account>` sets one. */
async function bank(
  text: string,
  customerId: string,
  args: string[],
  deps: CommandDeps,
): Promise<CommandOutcome> {
  if (args.length === 0) {
    const current = await deps.bankDetails(customerId).catch(() => null);
    return current && current.hasBank ? { kind: "bank_current", bank: current } : { kind: "bank_needs_details" };
  }
  const outcome = await handleBankDetails(text, customerId, { saveBank: deps.saveBank });
  return outcome.kind === "saved"
    ? { kind: "bank_saved", details: outcome.details }
    : { kind: "bank_needs_details" };
}

/**
 * The commands the assistant answers itself (`/donhang`, `/id`, `/matkhau`,
 * `/bank`, ...). It returns a KIND, never a finished sentence: the wording
 * comes from the message file at the point of sending.
 */
export async function handleCommand(
  text: string,
  customerId: string,
  deps: CommandDeps,
): Promise<CommandOutcome> {
  const parsed = parseCommand(text);
  if (!parsed) return { kind: "not_a_command" };

  if (ORDERS_COMMANDS.has(parsed.command)) return orders(customerId, deps);
  if (ID_COMMANDS.has(parsed.command)) return account(customerId, deps);
  if (PASSWORD_COMMANDS.has(parsed.command)) return password(customerId, deps);
  if (BANK_COMMANDS.has(parsed.command)) return bank(text, customerId, parsed.args, deps);
  return { kind: "unknown", command: parsed.command };
}
