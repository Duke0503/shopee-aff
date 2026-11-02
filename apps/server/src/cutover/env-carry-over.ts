/**
 * The values the new production env file takes over from the live system's `.env` at cutover
 * (Story 8.8, owner decisions of 2026-11-02): the Telegram bot and owner chat, the AccessTrade key,
 * the third party's product lookup key (ADDLIVETAG_API_KEY, in the live `C:\Project\mmo\.env`)
 * and the Zalo group ids. Each is copied only into a key the production file leaves unset or
 * blank, never over a value already there, and the answer names keys only: a value is read from
 * one file and written to the other, never printed, logged or returned. The secrets carried
 * (TELEGRAM_BOT_TOKEN, ACCESSTRADE_API_KEY, ADDLIVETAG_API_KEY) are the only ones the preflight then
 * accepts as shared with the live `.env` (D51 keeps every other secret new). The third party's key
 * was committed on `main` (the live default); the owner keeps it, so the preflight is run with
 * ADDLIVETAG_API_KEY in its accepted list and reports it as `committed_kept`.
 *
 * `fixed` values (the public port that takes over the tunnel's port, the live ledger path the
 * import refuses, the Zalo credentials path) are not secrets and are set even over another value.
 */
import { parseEnv } from "node:util";

export interface CarryRule {
  /** The key in the production env file. */
  readonly key: string;
  /** The live `.env` keys it is read from, the first set one wins; `union` joins id lists instead. */
  readonly from: readonly string[];
  readonly union?: boolean;
}

export const CARRY_RULES: readonly CarryRule[] = [
  { key: "TELEGRAM_BOT_TOKEN", from: ["TELEGRAM_BOT_TOKEN"] },
  { key: "TELEGRAM_CHAT_ID", from: ["TELEGRAM_CHAT_ID"] },
  { key: "ACCESSTRADE_API_KEY", from: ["ACCESSTRADE_API_KEY"] },
  { key: "ADDLIVETAG_API_KEY", from: ["ADDLIVETAG_API_KEY"] },
  // The live bot listens to its main group (ZALO_LISTEN_GROUP_IDS or ZALO_MAIN_GROUP_ID); the Dev
  // group is kept so the owner's go-live test link can be sent there.
  { key: "ZALO_GROUP_IDS", from: ["ZALO_LISTEN_GROUP_IDS", "ZALO_MAIN_GROUP_ID", "ZALO_TEST_GROUP_ID"], union: true },
];

/** The secrets the preflight accepts as shared with the live `.env`, because they are carried. */
export const CARRIED_SECRET_KEYS = ["TELEGRAM_BOT_TOKEN", "ACCESSTRADE_API_KEY", "ADDLIVETAG_API_KEY"] as const;

export interface CarryPlan {
  /** Keys written now from the live `.env`. */
  readonly carried: string[];
  /** Keys the production file already holds with the same value. */
  readonly already: string[];
  /** Keys the production file holds with another value: kept, never overwritten. */
  readonly kept: string[];
  /** Keys the live `.env` does not have either. */
  readonly missing: string[];
  /** Non-secret keys set to a fixed value. */
  readonly fixed: string[];
  /** The production file's new text; equal to the input when nothing changed. */
  readonly text: string;
}

export class CarryOverError extends Error {
  constructor(
    readonly code: "value_needs_quoting",
    readonly key: string,
  ) {
    super(`carry-over: ${code} (${key})`);
    this.name = "CarryOverError";
  }
}

const present = (value: string | undefined): value is string => value !== undefined && value.trim() !== "";

function valueOf(rule: CarryRule, old: Readonly<Record<string, string | undefined>>): string | null {
  const values = rule.from.map((key) => old[key]).filter(present).map((v) => v.trim());
  if (values.length === 0) return null;
  if (!rule.union) return values[0] ?? null;
  const ids = [...new Set(values.flatMap((v) => v.split(",").map((id) => id.trim()).filter((id) => id !== "")))];
  return ids.join(",");
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The value as an env-file entry that `parseEnv` reads back unchanged: bare when it is plain,
 * else in single quotes (taken literally), else double quotes, else backticks. A value no form
 * reads back (a line break, or every quote kind) is refused, naming the key only.
 */
export function envEntry(key: string, value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new CarryOverError("value_needs_quoting", key);
  const forms = [value, `'${value}'`, `"${value}"`, `\`${value}\``];
  for (const form of /^[^\s#"'`]*$/.test(value) ? forms : forms.slice(1)) {
    if (parseEnv(`${key}=${form}\n`)[key] === value) return `${key}=${form}`;
  }
  throw new CarryOverError("value_needs_quoting", key);
}

/** Writes the entry over the key's line, or appends it. */
function withValue(lines: string[], key: string, value: string): void {
  const entry = envEntry(key, value);
  const at = lines.findIndex((line) => new RegExp(`^\\s*(export\\s+)?${escapeRegExp(key)}\\s*=`).test(line));
  if (at >= 0) lines[at] = entry;
  else lines.push(entry);
}

/** The plan and the new text; pure, so it is tested without files. */
export function planCarryOver(oldText: string, prodText: string, fixed: Readonly<Record<string, string>> = {}): CarryPlan {
  const old = parseEnv(oldText);
  const prod = parseEnv(prodText);
  const lines = prodText.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  const plan = { carried: [] as string[], already: [] as string[], kept: [] as string[], missing: [] as string[], fixed: [] as string[] };
  for (const rule of CARRY_RULES) {
    const value = valueOf(rule, old);
    const current = prod[rule.key];
    if (value === null) {
      if (!present(current)) plan.missing.push(rule.key);
      else plan.kept.push(rule.key);
      continue;
    }
    if (present(current)) {
      (current.trim() === value ? plan.already : plan.kept).push(rule.key);
      continue;
    }
    withValue(lines, rule.key, value);
    plan.carried.push(rule.key);
  }
  for (const [key, value] of Object.entries(fixed)) {
    if (prod[key]?.trim() === value) continue;
    withValue(lines, key, value);
    plan.fixed.push(key);
  }
  const changed = plan.carried.length + plan.fixed.length > 0;
  return { ...plan, text: changed ? `${lines.join("\n")}\n` : prodText };
}
