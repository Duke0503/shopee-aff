import type { ApiBalance, ApiDeal, ApiOrder } from "@mmo/contracts";

import { handleBankDetails, type BankDetails } from "./bank-details";
import {
  BALANCE_COMMANDS,
  BANK_COMMANDS,
  BANK_GUIDE_COMMANDS,
  ERASE_BANK_COMMANDS,
  HELP_COMMANDS,
  ID_COMMANDS,
  ORDERS_COMMANDS,
  PASSWORD_COMMANDS,
  PING_COMMANDS,
  POLICY_COMMANDS,
  TERMS_COMMANDS,
  TOPDEAL_COMMANDS,
  WEBSITE_COMMANDS,
} from "./command-names";
import { parseCommand } from "./parse-message";

export {
  BALANCE_COMMANDS,
  BANK_COMMANDS,
  BANK_GUIDE_COMMANDS,
  ERASE_BANK_COMMANDS,
  HELP_COMMANDS,
  ID_COMMANDS,
  ORDERS_COMMANDS,
  PASSWORD_COMMANDS,
  PING_COMMANDS,
  POLICY_COMMANDS,
  TERMS_COMMANDS,
  TOPDEAL_COMMANDS,
  WEBSITE_COMMANDS,
};

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
  eraseBank: (customerId: string) => Promise<void>;
  balance: (customerId: string) => Promise<ApiBalance>;
  deals: () => Promise<ApiDeal[]>;
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
  | { kind: "bank_erased" }
  | { kind: "balance"; balance: ApiBalance; hasBank: boolean }
  | { kind: "topdeals"; deals: ApiDeal[] }
  /** A command whose answer is one fixed message key (no data needed). */
  | { kind: "static"; key: string }
  | { kind: "unknown"; command: string };

const EMPTY_BALANCE: ApiBalance = {
  approvedWaitingVnd: 0,
  stillWithShopVnd: 0,
  alreadyPaidVnd: 0,
};

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

async function balance(customerId: string, deps: CommandDeps): Promise<CommandOutcome> {
  const [totals, bank] = await Promise.all([
    deps.balance(customerId).catch(() => null),
    deps.bankDetails(customerId).catch(() => null),
  ]);
  return { kind: "balance", balance: totals ?? EMPTY_BALANCE, hasBank: Boolean(bank?.hasBank) };
}

async function topdeals(deps: CommandDeps): Promise<CommandOutcome> {
  const list = await deps.deals().catch(() => []);
  return { kind: "topdeals", deals: list };
}

/**
 * The commands the assistant answers itself (`/donhang`, `/id`, `/matkhau`,
 * `/sodu`, `/bank`, ...). It returns a KIND, never a finished sentence: the
 * wording comes from the message file at the point of sending.
 */
export async function handleCommand(
  text: string,
  customerId: string,
  deps: CommandDeps,
): Promise<CommandOutcome> {
  const parsed = parseCommand(text);
  if (!parsed) return { kind: "not_a_command" };

  const { command } = parsed;
  if (ORDERS_COMMANDS.has(command)) return orders(customerId, deps);
  if (ID_COMMANDS.has(command)) return account(customerId, deps);
  if (PASSWORD_COMMANDS.has(command)) return password(customerId, deps);
  if (BALANCE_COMMANDS.has(command)) return balance(customerId, deps);
  if (BANK_COMMANDS.has(command)) return bank(text, customerId, parsed.args, deps);
  if (BANK_GUIDE_COMMANDS.has(command)) return { kind: "static", key: "need_bank" };
  if (ERASE_BANK_COMMANDS.has(command)) {
    await deps.eraseBank(customerId).catch(() => undefined);
    return { kind: "bank_erased" };
  }
  if (TOPDEAL_COMMANDS.has(command)) return topdeals(deps);
  if (PING_COMMANDS.has(command)) return { kind: "static", key: "ping" };
  if (WEBSITE_COMMANDS.has(command)) return { kind: "static", key: "website" };
  if (HELP_COMMANDS.has(command)) return { kind: "static", key: "rules" };
  if (POLICY_COMMANDS.has(command)) return { kind: "static", key: "policy" };
  if (TERMS_COMMANDS.has(command)) return { kind: "static", key: "terms" };
  return { kind: "unknown", command };
}
