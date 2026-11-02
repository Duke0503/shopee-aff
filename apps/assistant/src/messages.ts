/**
 * Customer text by key (AD-15, D57). Every sentence the assistant sends lives in
 * packages/labels/vi/messages.json, never in code; the live system's resources/messages.vi.json is
 * never read from here. The labels carry the live bot's words, line breaks, emoji and bold parts
 * (owner requirement 2026-11-02, docs/operations/message-parity.md); `**...**` marks a bold run
 * (styled-text.ts). An unknown key throws, so a typo is found by a test, not by a customer, and so
 * does a sentence with a placeholder left unfilled: a raw `{link}` never reaches anyone.
 */
import messages from "@cashback/labels/vi/messages.json" with { type: "json" };

import { renderStyled, type StyledText, type StyledValue } from "./styled-text";

export type MessageKey = keyof typeof messages;

export type MessageValues = Readonly<Record<string, StyledValue>>;

function templateOf(key: string): string {
  const template: unknown = (messages as Record<string, unknown>)[key];
  if (typeof template !== "string") throw new Error(`unknown message key: ${key}`);
  return template;
}

/** The message with its bold runs as zca-js style ranges. */
export function styledMessage(key: MessageKey, values: MessageValues = {}): StyledText {
  const missing: string[] = [];
  const styled = renderStyled(templateOf(String(key)), (name) => {
    const value = values[name];
    if (value === undefined) missing.push(name);
    return value;
  });
  if (missing.length > 0) throw new MessageIncompleteError(String(key), missing);
  return styled;
}

/** The message as it reads, without its styles. */
export function messageText(key: MessageKey, values: MessageValues = {}): string {
  return styledMessage(key, values).text;
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
