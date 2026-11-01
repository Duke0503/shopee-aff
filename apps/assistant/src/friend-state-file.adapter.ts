/**
 * The friend-request state file (AD-15, D9): `friend-requests.json` in the assistant's own data
 * folder, never the server's ledger and no database. It is written whole to a temporary file and
 * renamed over the old one, so a crash leaves either the old or the new state. A missing file
 * starts the count at zero; an unreadable one does too, with a warning, so a corrupt file never
 * stops the assistant. File access is injected; tests use an in-memory one.
 */
import { join } from "node:path";
import { parseVnDate } from "@cashback/core";
import { z } from "zod";

import type { FriendRequestState, FriendStateStore } from "./friend-request";

export const FRIEND_STATE_FILE = "friend-requests.json";

/** The file operations the store uses; `node:fs` in main.ts. */
export interface StateFiles {
  readFile(path: string): string | null;
  writeFile(path: string, text: string): void;
  rename(from: string, to: string): void;
}

const stateSchema = z.strictObject({
  day: z.string().transform((day) => parseVnDate(day)),
  count: z.number().int().min(0),
  requested: z.array(z.string().min(1)),
});

export function fileFriendStateStore(dataDir: string, files: StateFiles, warn: (event: string) => void): FriendStateStore {
  const path = join(dataDir, FRIEND_STATE_FILE);
  return {
    load: () => {
      const text = files.readFile(path);
      if (text === null) {
        warn("assistant.friend_state.missing");
        return null;
      }
      try {
        return stateSchema.parse(JSON.parse(text)) satisfies FriendRequestState;
      } catch {
        warn("assistant.friend_state.unreadable");
        return null;
      }
    },
    save: (state) => {
      const temporary = `${path}.tmp`;
      files.writeFile(temporary, JSON.stringify(state));
      files.rename(temporary, path);
    },
  };
}
