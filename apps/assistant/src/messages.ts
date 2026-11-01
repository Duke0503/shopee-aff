/**
 * Customer text by key (AD-15, D57). Every sentence the assistant sends lives in
 * packages/labels/vi/messages.json, never in code; the live system's resources/messages.vi.json is
 * never read from here. An unknown key throws, so a typo is found by a test, not by a customer.
 */
import messages from "@cashback/labels/vi/messages.json" with { type: "json" };

export type MessageKey = keyof typeof messages;

export function messageText(key: MessageKey, values: Readonly<Record<string, string | number>> = {}): string {
  const template: unknown = (messages as Record<string, unknown>)[key];
  if (typeof template !== "string") throw new Error(`unknown message key: ${String(key)}`);
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = values[name];
    return value === undefined ? whole : String(value);
  });
}
