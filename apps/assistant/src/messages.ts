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
