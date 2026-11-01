/**
 * The assistant's entry (AD-15, AD-25): reads the env file, opens the one Zalo session (the fake
 * unless `ZALO_MODE=account`), and runs until SIGINT or SIGTERM. It binds no port and opens no
 * database.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { systemClock } from "@cashback/core";

import { startAssistant } from "./assistant";
import { loadAssistantConfig } from "./assistant.config";
import { assistantLogger } from "./assistant-log";
import { fileFriendStateStore, type StateFiles } from "./friend-state-file.adapter";
import { internalApi } from "./internal-api.adapter";
import { timerSleep } from "./pacer";
import { openZaloSession } from "./zalo-session";

const NODE_FILES: StateFiles = {
  readFile: (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  },
  writeFile: (path, text) => writeFileSync(path, text, "utf8"),
  rename: renameSync,
};

async function main(): Promise<void> {
  const config = loadAssistantConfig();
  const log = assistantLogger(config.logLevel);
  const onError = (event: string, error: unknown) => log.warn({ error: error instanceof Error ? error.name : "unknown" }, event);
  mkdirSync(config.dataDir, { recursive: true });
  const friendState = fileFriendStateStore(config.dataDir, NODE_FILES, (event) => log.warn({}, event));
  const zalo = await openZaloSession(config, systemClock, (error) => onError("assistant.message.failed", error));
  const assistant = startAssistant({
    zalo,
    api: internalApi({ baseUrl: config.internalBaseUrl, token: config.assistantToken, fetch }),
    clock: systemClock,
    sleep: timerSleep,
    sendDelay: config.sendDelay,
    zaloGroupIds: config.zaloGroupIds,
    friendRequestsPerDay: config.friendRequestsPerDay,
    friendState,
    onError,
  });
  log.info({ env: config.env, zalo: zalo.mode, groups: config.zaloGroupIds.length }, "assistant.process.started");
  const shutdown = () => {
    void assistant.stop().then(() => log.info({}, "assistant.process.stopped"));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "assistant failed to start");
  process.exitCode = 1;
});
