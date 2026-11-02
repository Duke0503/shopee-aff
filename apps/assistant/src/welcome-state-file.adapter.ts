/**
 * The group welcome state file (group-welcome.ts): `group-welcomes.json` in the assistant's own
 * data folder, the list of `groupId:userId` already welcomed. Written whole to a temporary file and
 * renamed over the old one, like the friend state file; a missing or unreadable file starts empty,
 * with a warning.
 */
import { join } from "node:path";
import { z } from "zod";

import type { StateFiles } from "./friend-state-file.adapter";
import type { WelcomeStore } from "./group-welcome";

export const WELCOME_STATE_FILE = "group-welcomes.json";

const stateSchema = z.strictObject({ welcomed: z.array(z.string().regex(/^[A-Za-z0-9]{1,40}:[A-Za-z0-9]{1,40}$/)) });

export function fileWelcomeStore(dataDir: string, files: StateFiles, warn: (event: string) => void): WelcomeStore {
  const path = join(dataDir, WELCOME_STATE_FILE);
  return {
    load: () => {
      const text = files.readFile(path);
      if (text === null) {
        warn("assistant.welcome_state.missing");
        return null;
      }
      try {
        return stateSchema.parse(JSON.parse(text)).welcomed;
      } catch {
        warn("assistant.welcome_state.unreadable");
        return null;
      }
    },
    save: (welcomed) => {
      const temporary = `${path}.tmp`;
      files.writeFile(temporary, JSON.stringify({ welcomed }));
      files.rename(temporary, path);
    },
  };
}
