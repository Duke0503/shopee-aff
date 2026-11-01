/**
 * Customer text by key (AD-15, D57). Every sentence the assistant sends lives in
 * packages/labels/vi/messages.json, never in code; the live system's resources/messages.vi.json is
 * never read from here. An unknown key throws, so a typo is found by a test, not by a customer,
 * and so does a sentence with a placeholder left unfilled: a raw `{link}` never reaches anyone.
 */
import messages from "@cashback/labels/vi/messages.json" with { type: "json" };

export type MessageKey = keyof typeof messages;

export function messageText(key: MessageKey, values: Readonly<Record<string, string | number>> = {}): string {
  const template: unknown = (messages as Record<string, unknown>)[key];
  if (typeof template !== "string") throw new Error(`unknown message key: ${String(key)}`);
  const missing: string[] = [];
  const text = template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = values[name];
    if (value === undefined) missing.push(name);
    return value === undefined ? whole : String(value);
  });
  if (missing.length > 0) throw new MessageIncompleteError(String(key), missing);
  return text;
}

export class MessageIncompleteError extends Error {
  constructor(
    readonly key: string,
    readonly missing: readonly string[],
  ) {
    super(`message ${key} has no value for ${missing.join(", ")}`);
    this.name = "MessageIncompleteError";
  }
}

/** The placeholders a sentence needs, `{name}` each. */
export function placeholdersOf(key: MessageKey): string[] {
  return [...String((messages as Record<string, unknown>)[key]).matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "");
}

/** True when the message file has a sentence for `key`. */
export function isMessageKey(key: string): key is MessageKey {
  return typeof (messages as Record<string, unknown>)[key] === "string";
}
