import { readFileSync } from "node:fs";

/**
 * Customer-facing wording, ported from `messaging/templates.py`. Every
 * customer message lives in `resources/messages.vi.json`, never in code, so
 * it can be edited without a deploy and never drifts between two copies.
 */
export type Messages = Record<string, string>;

export function loadMessages(path: string): Messages {
  return JSON.parse(readFileSync(path, "utf8")) as Messages;
}

/** Replace `{name}` placeholders. Unknown keys throw; unknown placeholders stay. */
export function render(
  messages: Messages,
  key: string,
  values: Record<string, string | number> = {},
): string {
  const template = messages[key];
  if (template === undefined) {
    throw new Error(`unknown message key: ${key}`);
  }
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = values[name];
    return value === undefined ? whole : String(value);
  });
}

/**
 * A whole-dong amount as the customer sees it: `40.000đ`. Formatting only —
 * no money is decided here — and both the separator and the symbol come from
 * the message file, so they change in one place.
 */
export function formatVnd(messages: Messages, amount: number): string {
  const separator = messages["thousands_separator"] ?? ".";
  const symbol = messages["currency"] ?? "";
  const whole = Math.trunc(Math.abs(amount));
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, separator);
  return `${amount < 0 ? "-" : ""}${grouped}${symbol}`;
}
