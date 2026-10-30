/**
 * Reading what a customer sent in Zalo. Ports the small parsing the old
 * assistant did inline: pull the first link out of a message, and recognise a
 * `/command` (the customer commands such as `/donhang`).
 *
 * Shop detection is NOT done here — the assistant asks the server, so the one
 * list of shop domains stays on the server.
 */
const URL_PATTERN = /https?:\/\/[^\s<>"']+/i;

export function extractFirstUrl(text: string): string | null {
  const match = URL_PATTERN.exec(text ?? "");
  if (!match) return null;
  return match[0].replace(/[.,!?)\]]+$/, "");
}

export interface ParsedCommand {
  command: string;
  args: string[];
}

/** "/donhang" -> { command: "donhang", args: [] }. Plain text -> null. */
export function parseCommand(text: string): ParsedCommand | null {
  const trimmed = (text ?? "").trim();
  if (!trimmed.startsWith("/")) return null;
  const [rawCommand = "", ...args] = trimmed.slice(1).split(/\s+/);
  const command = rawCommand.toLowerCase();
  if (command === "") return null;
  return { command, args };
}
