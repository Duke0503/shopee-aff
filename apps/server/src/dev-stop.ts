/**
 * `pnpm dev:stop` (Story 8.1 AC2, AD-25): stops the dev server `pnpm dev:start` recorded in
 * `run/dev/server.pid` (RUN_DIR), and nothing else: no process is found by name, and a recorded
 * PID whose process started at another time (the OS reused it) is left running. It asks the server
 * for an ordered stop through `POST /internal/shutdown` with the internal token and waits; only a
 * server still running after the wait is killed (`platform.dev.forced`). When the dev config cannot
 * be read the default `run/dev` is used and the stop is a kill, so a broken env file never strands
 * a running server. Prints one JSON line with the outcome; exit 0.
 */
import { join } from "node:path";
import { systemClock } from "@cashback/core";

import { ConfigError, loadConfigFor, REPOSITORY_ROOT, type ServerConfig } from "./platform/config/env.config";
import { JOB_STOP_TIMEOUT_MS } from "./platform/jobs/job-schedules";
import { osProcessProbe, pidFilePath, stopRecorded, type GracefulStop } from "./platform/lifecycle/dev-process";
import { SHUTDOWN_PATH } from "./platform/lifecycle/shutdown.routes";
import { INTERNAL_TOKEN_HEADER } from "./platform/http/internal-token.guard";
import { LOOPBACK } from "./platform/http/servers";

function devConfig(): ServerConfig | null {
  try {
    return loadConfigFor("dev");
  } catch (error) {
    if (error instanceof ConfigError) return null;
    throw error;
  }
}

function orderedStop(config: ServerConfig): GracefulStop {
  return {
    waitMs: JOB_STOP_TIMEOUT_MS + 10_000,
    request: async () => {
      const answer = await fetch(`http://${LOOPBACK}:${config.internalPort}${SHUTDOWN_PATH}`, { method: "POST", headers: { [INTERNAL_TOKEN_HEADER]: config.internalToken }, signal: AbortSignal.timeout(5_000) });
      return answer.status === 202;
    },
  };
}

const config = devConfig();
const runDir = config?.runDir ?? join(REPOSITORY_ROOT, "run", "dev");
const result = await stopRecorded(pidFilePath(runDir), osProcessProbe, systemClock, config === null ? undefined : orderedStop(config));
process.stdout.write(`${JSON.stringify({ event: `platform.dev.${result.outcome}`, pid: result.pid })}\n`);
