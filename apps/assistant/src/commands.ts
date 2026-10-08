import type { ApiOrder } from "@mmo/contracts";

import { parseCommand } from "./parse-message";

/**
 * The customer commands the assistant answers directly (`/donhang`,
 * `/bank`, ...). It returns a KIND, never a finished sentence: the wording
 * comes from the message file at the point of sending.
 */
export interface CommandDeps {
  myOrders: (customerId: string) => Promise<ApiOrder[]>;
}

export type CommandOutcome =
  | { kind: "not_a_command" }
  | { kind: "orders"; orders: ApiOrder[] }
  | { kind: "bank_prompt" }
  | { kind: "unknown"; command: string };

export const ORDERS_COMMANDS = new Set(["donhang", "orders"]);
export const BANK_COMMANDS = new Set(["bank", "stk", "taikhoan"]);

export async function handleCommand(
  text: string,
  customerId: string,
  deps: CommandDeps,
): Promise<CommandOutcome> {
  const parsed = parseCommand(text);
  if (!parsed) return { kind: "not_a_command" };

  if (ORDERS_COMMANDS.has(parsed.command)) {
    const orders = await deps.myOrders(customerId).catch(() => []);
    return { kind: "orders", orders };
  }
  if (BANK_COMMANDS.has(parsed.command)) return { kind: "bank_prompt" };
  return { kind: "unknown", command: parsed.command };
}
