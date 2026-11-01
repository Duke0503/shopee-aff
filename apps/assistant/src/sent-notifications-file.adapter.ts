/**
 * The assistant's own record of the notifications it sent (AD-15, AD-16; Story 6.4):
 * `sent-notifications.json` in its data folder, never the server's ledger. A key is written right
 * after its send succeeded and before the ack, so a notification handed out again after a crash
 * or a lost ack is acknowledged without a second send. Keys are the outbox dedup keys: they name
 * the event, so they stay right even if a ledger is rebuilt and its row ids start again. The
 * server drops unsent rows after 7 days, so a key older than 8 days is forgotten. The file is
 * written whole to a temporary file and renamed, like the friend-request state; a missing or
 * unreadable file starts empty with a warning.
 */
import { join } from "node:path";
import { INSTANT_PATTERN, toMs, type Clock, type Instant } from "@cashback/core";
import { z } from "zod";

import type { StateFiles } from "./friend-state-file.adapter";

export const SENT_NOTIFICATIONS_FILE = "sent-notifications.json";
export const SENT_KEY_KEEP_MS = 8 * 24 * 60 * 60_000;

export interface SentNotifications {
  has(dedupKey: string): boolean;
  /** Records a sent key; it is on disk when this returns. */
  add(dedupKey: string): void;
}

const fileSchema = z.strictObject({ sent: z.array(z.strictObject({ key: z.string().min(1), at: z.string().regex(INSTANT_PATTERN) })) });

export function memorySentNotifications(): SentNotifications & { readonly keys: ReadonlySet<string> } {
  const keys = new Set<string>();
  return { keys, has: (key) => keys.has(key), add: (key) => void keys.add(key) };
}

export function fileSentNotifications(dataDir: string, files: StateFiles, clock: Clock, warn: (event: string) => void): SentNotifications {
  const path = join(dataDir, SENT_NOTIFICATIONS_FILE);
  const sent = new Map<string, Instant>();
  const text = files.readFile(path);
  if (text === null) warn("assistant.sent_notifications.missing");
  else {
    try {
      for (const entry of fileSchema.parse(JSON.parse(text)).sent) sent.set(entry.key, entry.at as Instant);
    } catch {
      warn("assistant.sent_notifications.unreadable");
    }
  }
  const save = (): void => {
    const keepFrom = toMs(clock.now()) - SENT_KEY_KEEP_MS;
    for (const [key, at] of sent) if (toMs(at) < keepFrom) sent.delete(key);
    const temporary = `${path}.tmp`;
    files.writeFile(temporary, JSON.stringify({ sent: [...sent].map(([key, at]) => ({ key, at })) }));
    files.rename(temporary, path);
  };
  return {
    has: (key) => sent.has(key),
    add: (key) => {
      sent.set(key, clock.now());
      save();
    },
  };
}
