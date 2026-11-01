/**
 * Reading what a person sent in Zalo, ported from the v2 attempt: the first link in a message and
 * a `/command` with its arguments. Which shop a link belongs to is decided on the server, so the
 * one list of shop domains stays there. Registration and the commands themselves come with
 * Stories 6.2 onward.
 */
const URL_PATTERN = /https?:\/\/[^\s<>"']+/i;
const TRAILING_PUNCTUATION = /[.,!?)\]]+$/;
/** Longer than any product link the server accepts (SHOPEE_PASTE_MAX_LENGTH); longer text is cut before matching. */
const MAX_SCANNED_LENGTH = 8_192;

export function extractFirstUrl(text: string): string | null {
  const match = URL_PATTERN.exec(text.slice(0, MAX_SCANNED_LENGTH));
  if (!match) return null;
  return match[0].replace(TRAILING_PUNCTUATION, "");
}

const CUSTOMER_CODE = /\bDP\s?(\d{5,})\b/i;

/** A customer code written in a message ("DP00012", "dp 00012"), upper case, or null (Story 6.11). */
export function customerCodeIn(text: string): string | null {
  const digits = CUSTOMER_CODE.exec(text.slice(0, MAX_SCANNED_LENGTH))?.[1];
  return digits === undefined ? null : `DP${digits}`;
}

export interface ParsedCommand {
  readonly command: string;
  readonly args: readonly string[];
}

/** `/orders` gives `{ command: "orders", args: [] }`; plain text gives null. */
export function parseCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const [rawCommand = "", ...args] = trimmed.slice(1).split(/\s+/);
  const command = rawCommand.toLowerCase();
  return command === "" ? null : { command, args };
}
