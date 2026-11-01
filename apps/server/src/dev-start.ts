/**
 * `pnpm dev:start` (Story 8.1, AD-25): starts the dev server in the background on dev's own
 * ports, data folder and `~/.config/cashback/dev.env`. It refuses before anything starts when
 * `CASHBACK_ENV` names another environment, when the dev config points at a production resource
 * (the isolation check), or when the recorded dev server is still running. It reports `started`
 * only once the server answers its health route; the PID goes into `run/dev/server.pid` (RUN_DIR)
 * for `pnpm dev:stop` only then. A server that fails to spawn, exits early or stays silent past the
 * wait is reported `failed` with the reason (a silent one is killed: it is the PID this script just
 * started). The server's own output goes to `<data dir>/logs/server.log`. Prints one JSON line;
 * exit 0 on start, 1 on a refusal or a failure.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { systemClock } from "@cashback/core";

import { childEnvironment, ConfigError, loadConfigFor, requestedEnvironment, type ServerConfig } from "./platform/config/env.config";
import { LOOPBACK } from "./platform/http/servers";
import { isRecordedProcess, osProcessProbe, pidFilePath, readPidRecord, writePidRecord } from "./platform/lifecycle/dev-process";

const SERVER_DIR = fileURLToPath(new URL("..", import.meta.url));
const MAIN = join(SERVER_DIR, "src", "main.ts");
const HEALTH_WAIT_MS = 60_000;
const HEALTH_POLL_MS = 200;

type Outcome = { event: string; [key: string]: unknown };

function devConfig(): ServerConfig | Outcome {
  const asked = requestedEnvironment();
  if (asked !== null && asked !== "dev") return { event: "platform.dev.refused", reason: "not_dev", env: asked };
  try {
    return loadConfigFor("dev");
  } catch (error) {
    if (error instanceof ConfigError) return { event: "platform.dev.refused", reason: "config", message: error.message };
    throw error;
  }
}

type Readiness = { ready: true } | { ready: false; reason: string };

/** Resolves when the health route answers, the child exits or errors, or the wait ends. */
async function readiness(child: ChildProcess, publicPort: number): Promise<Readiness> {
  let ended: Readiness | null = null;
  child.once("error", (error) => (ended = { ready: false, reason: `spawn_error: ${error.message}` }));
  child.once("exit", (code) => (ended = ended ?? { ready: false, reason: `exited with code ${String(code)} (see server.log)` }));
  for (let waited = 0; waited < HEALTH_WAIT_MS; waited += HEALTH_POLL_MS) {
    if (ended !== null) return ended;
    const ok = await fetch(`http://${LOOPBACK}:${publicPort}/api/health`, { signal: AbortSignal.timeout(2_000) }).then((r) => r.ok, () => false);
    if (ok && ended === null) return { ready: true };
    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_MS));
  }
  return ended ?? { ready: false, reason: "not_healthy" };
}

async function start(): Promise<{ outcome: Outcome; code: number }> {
  const config = devConfig();
  if ("event" in config) return { outcome: config, code: 1 };
  const pidFile = pidFilePath(config.runDir);
  const recorded = readPidRecord(pidFile);
  if (recorded !== null && isRecordedProcess(recorded, osProcessProbe, systemClock)) return { outcome: { event: "platform.dev.refused", reason: "already_running", pid: recorded.pid }, code: 1 };
  const logs = join(config.dataDir, "logs");
  mkdirSync(logs, { recursive: true });
  const log = openSync(join(logs, "server.log"), "a");
  const startedAt = systemClock.now();
  const child = spawn(process.execPath, ["--import", "tsx", MAIN], { cwd: SERVER_DIR, env: childEnvironment("dev"), detached: true, stdio: ["ignore", log, log], windowsHide: true });
  const state = await readiness(child, config.publicPort);
  if (!state.ready) {
    if (child.exitCode === null && child.pid !== undefined) child.kill();
    return { outcome: { event: "platform.dev.failed", reason: state.reason }, code: 1 };
  }
  if (child.pid === undefined) return { outcome: { event: "platform.dev.failed", reason: "no_pid" }, code: 1 };
  writePidRecord(pidFile, { pid: child.pid, startedAt });
  child.unref();
  return { outcome: { event: "platform.dev.started", pid: child.pid, publicPort: config.publicPort, internalPort: config.internalPort, bridge: config.bridgeMode, zalo: config.zaloMode }, code: 0 };
}

const { outcome, code } = await start();
process.stdout.write(`${JSON.stringify(outcome)}\n`);
process.exitCode = code;
