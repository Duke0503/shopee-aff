/**
 * `pnpm host <command>` (Story 8.5, AD-25, D61): the production host's processes as the Task
 * Scheduler tasks and the owner's PowerShell scripts in ops/windows/ run them. The environment is
 * always named (`--env prod` or `--env dev`), because a scheduled task cannot set CASHBACK_ENV.
 *
 *   host run    <server|assistant|browser> --env <env> [--edge <msedge.exe>]   (what each task runs)
 *   host start  <server|assistant|browser|all> --env <env> [--edge <msedge.exe>]
 *   host stop   <server|assistant|browser|all> --env <env>
 *   host status --env <env>
 *   host check  --env <env> [--tunnel-config <config.yml>] [--main-ref <ref>] [--also-env <file>]
 *   host tunnel-check --config <config.yml> [--port <n>]
 *
 * start and stop act only on the PIDs recorded in `run/<env>/<role>.pid` (host-process.ts); the
 * server is stopped in order through its internal shutdown route, the assistant and Edge by their
 * recorded PID. `check` is the go-live preflight: the env file loads with its isolation check, the
 * production settings are all present, no secret was ever committed on main (D51) or is shared
 * with the live `.env`, and the tunnel exposes only the public listener. Each command prints JSON
 * lines (key names only, never a value); exit 0 only when every part succeeded.
 */
import { spawn } from "node:child_process";
import { mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs, parseEnv } from "node:util";
import { systemClock, toMs } from "@cashback/core";

import { childEnvironment, configFilePath, ConfigError, ENVIRONMENTS, loadConfigFor, REPOSITORY_ROOT, type Environment, type ServerConfig } from "../platform/config/env.config";
import { INTERNAL_TOKEN_HEADER } from "../platform/http/internal-token.guard";
import { LOOPBACK } from "../platform/http/servers";
import { JOB_STOP_TIMEOUT_MS } from "../platform/jobs/job-schedules";
import { osProcessProbe, stopRecorded, type GracefulStop } from "../platform/lifecycle/dev-process";
import { SHUTDOWN_PATH } from "../platform/lifecycle/shutdown.routes";
import { phaseFilePath, readServerPhase } from "../platform/lifecycle/server-phase";
import { acquireServerLock } from "../platform/lock/server-lock";
import { EDGE_CANDIDATES, findEdge, HOST_ROLES, HostLaunchError, hostLockFileOf, launchSpec, pidFileOf, recordedState, runRecorded, START_ORDER, startRecorded, type HostRole, type Launched, type LaunchSpec, type NotReady, waitForServer } from "./host-process";
import { productionGaps } from "./production-readiness";
import { blobsOf, existingRef, gitIn, keysFoundIn, keysSharedWith, searchedSecrets } from "./secrets-check";
import { checkTunnelConfig } from "./tunnel-config";

type Line = { readonly event: string; readonly [key: string]: unknown };

const ALIVE_WAIT_MS = 5_000;
const POLL_MS = 250;

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** `detached`: the start command returns and leaves the child running; `run` waits for it. */
function launch(env: Environment, spec: LaunchSpec, detached: boolean): Launched {
  let exited = false;
  const out = spec.log === null ? "ignore" : (mkdirSync(dirname(spec.log), { recursive: true }), openSync(spec.log, "a"));
  const child = spawn(spec.command, [...spec.args], { cwd: spec.cwd, env: childEnvironment(env), detached, stdio: ["ignore", out, out], windowsHide: spec.role !== "browser" });
  const ended = new Promise<number | null>((resolve) => {
    child.once("exit", (code) => resolve(code));
    child.once("error", () => resolve(null));
  });
  void ended.then(() => (exited = true));
  if (detached) child.unref();
  return { pid: child.pid, exited: () => exited, exitCode: () => ended, kill: () => void child.kill() };
}

function readiness(config: ServerConfig) {
  return async (spec: LaunchSpec, child: Launched): Promise<NotReady | null> => {
    if (spec.ready === "alive") {
      await pause(ALIVE_WAIT_MS);
      return child.exited() ? { reason: "exited (see its log)", kill: false } : null;
    }
    const phaseFile = phaseFilePath(config.runDir);
    return waitForServer({
      healthy: () => fetch(`http://${LOOPBACK}:${config.publicPort}/api/health`, { signal: AbortSignal.timeout(2_000) }).then((r) => r.ok, () => false),
      starting: () => {
        const phase = readServerPhase(phaseFile);
        return phase !== null && phase.pid === child.pid && phase.phase === "starting";
      },
      exited: () => child.exited(),
      now: () => toMs(systemClock.now()),
      pause,
      pollMs: POLL_MS,
    });
  };
}

/** The role's host lock, an OS lock dropped when this command exits (platform/lock/server-lock.ts). */
const hostLock = (config: ServerConfig, role: HostRole) => () => acquireServerLock(hostLockFileOf(config.runDir, role));

function rolesOf(name: string | undefined): HostRole[] | null {
  if (name === "all") return [...START_ORDER];
  return (HOST_ROLES as readonly (string | undefined)[]).includes(name) ? [name as HostRole] : null;
}

function specOf(env: Environment, config: ServerConfig, role: HostRole, edge: string | undefined): LaunchSpec | Line {
  try {
    return launchSpec(role, config, { repositoryRoot: REPOSITORY_ROOT, node: process.execPath, edge: edge ?? findEdge(EDGE_CANDIDATES) });
  } catch (error) {
    if (!(error instanceof HostLaunchError)) throw error;
    return { event: "platform.host.failed", env, role, reason: error.reason };
  }
}

async function start(env: Environment, config: ServerConfig, roles: readonly HostRole[], edge: string | undefined): Promise<Line[]> {
  const lines: Line[] = [];
  for (const role of roles) {
    const spec = specOf(env, config, role, edge);
    if ("event" in spec) {
      lines.push(spec);
      continue;
    }
    const result = await startRecorded(spec, { pidFile: pidFileOf(config.runDir, role), probe: osProcessProbe, clock: systemClock, launch: (s) => launch(env, s, true), ready: readiness(config), lock: hostLock(config, role) });
    lines.push({ event: `platform.host.${result.outcome}`, env, role, ...result });
  }
  return lines;
}

/** One role in the foreground, as its task runs it; the exit code follows the process's. */
async function runRole(env: Environment, config: ServerConfig, role: HostRole, edge: string | undefined): Promise<{ lines: Line[]; code: number }> {
  const spec = specOf(env, config, role, edge);
  if ("event" in spec) return { lines: [spec], code: 1 };
  const result = await runRecorded(spec, { pidFile: pidFileOf(config.runDir, role), probe: osProcessProbe, clock: systemClock, launch: (s) => launch(env, s, false), ready: readiness(config), lock: hostLock(config, role) });
  const code = result.outcome === "exited" ? (result.code ?? 1) : result.outcome === "failed" ? 1 : 0;
  return { lines: [{ event: `platform.host.${result.outcome}`, env, role, ...result }], code };
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

async function stop(env: Environment, config: ServerConfig, roles: readonly HostRole[]): Promise<Line[]> {
  const lines: Line[] = [];
  for (const role of [...roles].reverse()) {
    const result = await stopRecorded(pidFileOf(config.runDir, role), osProcessProbe, systemClock, role === "server" ? orderedStop(config) : undefined);
    lines.push({ event: `platform.host.${result.outcome}`, env, role, pid: result.pid });
  }
  return lines;
}

function status(env: Environment, config: ServerConfig): Line[] {
  return HOST_ROLES.map((role) => ({ event: "platform.host.status", env, role, ...recordedState(pidFileOf(config.runDir, role), osProcessProbe, systemClock) }));
}

function tunnelLine(path: string, port: number): Line {
  const result = checkTunnelConfig(readFileSync(path, "utf8"), port);
  return { event: result.ok ? "platform.host.tunnel_ok" : "platform.host.tunnel_refused", port, rules: result.rules, problems: result.problems };
}

function check(env: Environment, config: ServerConfig, options: { tunnel?: string | undefined; mainRef?: string | undefined; alsoEnv?: string | undefined }): Line[] {
  const lines: Line[] = [{ event: "platform.host.config_ok", env, file: configFilePath(env) }];
  const gaps = env === "prod" ? productionGaps(config) : [];
  lines.push({ event: gaps.length === 0 ? "platform.host.settings_ok" : "platform.host.settings_missing", keys: gaps });
  const secrets = searchedSecrets(parseEnv(readFileSync(configFilePath(env), "utf8")));
  const git = gitIn(REPOSITORY_ROOT);
  const ref = existingRef(git, options.mainRef ? [options.mainRef] : ["main", "origin/main"]);
  if (ref === null) lines.push({ event: "platform.host.secrets_unchecked", reason: "main_ref_not_found" });
  else {
    const committed = keysFoundIn(secrets, blobsOf(git, ref));
    lines.push({ event: committed.length === 0 ? "platform.host.secrets_rotated" : "platform.host.secrets_committed", ref, keys: committed });
  }
  if (options.alsoEnv) {
    const shared = keysSharedWith(secrets, parseEnv(readFileSync(options.alsoEnv, "utf8")));
    lines.push({ event: shared.length === 0 ? "platform.host.secrets_not_shared" : "platform.host.secrets_shared", keys: shared });
  }
  if (options.tunnel) lines.push(tunnelLine(options.tunnel, config.publicPort));
  return lines;
}

const FAILED = /\.(failed|refused|unverified|settings_missing|secrets_committed|secrets_shared|secrets_unchecked|tunnel_refused|usage)$/;

async function run(argv: readonly string[]): Promise<Line[] | { lines: Line[]; code: number }> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: { env: { type: "string" }, edge: { type: "string" }, config: { type: "string" }, port: { type: "string" }, "tunnel-config": { type: "string" }, "main-ref": { type: "string" }, "also-env": { type: "string" } },
  });
  const [command, target] = positionals;
  if (command === "tunnel-check") {
    if (!values.config) return [{ event: "platform.host.usage", usage: "tunnel-check --config <config.yml> [--port <n>]" }];
    return [tunnelLine(values.config, Number(values.port ?? 8080))];
  }
  const env = (ENVIRONMENTS as readonly (string | undefined)[]).includes(values.env) ? (values.env as Environment) : null;
  if (env === null) return [{ event: "platform.host.usage", usage: "start|stop <role|all> --env dev|prod; status|check --env dev|prod" }];
  const config = loadConfigFor(env);
  if (command === "status") return status(env, config);
  if (command === "check") return check(env, config, { tunnel: values["tunnel-config"], mainRef: values["main-ref"], alsoEnv: values["also-env"] });
  if (command === "run") {
    const one = rolesOf(target);
    if (one === null || one.length !== 1) return [{ event: "platform.host.usage", usage: "run <server|assistant|browser> --env dev|prod" }];
    return runRole(env, config, one[0] as HostRole, values.edge);
  }
  const roles = rolesOf(target);
  if (roles === null || (command !== "start" && command !== "stop")) return [{ event: "platform.host.usage", usage: "start|stop <server|assistant|browser|all> --env dev|prod" }];
  return command === "start" ? start(env, config, roles, values.edge) : stop(env, config, roles);
}

let answer: Line[] | { lines: Line[]; code: number };
try {
  answer = await run(process.argv.slice(2).filter((arg) => arg !== "--"));
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  answer = [{ event: "platform.host.refused", reason: "config", message: error.message }];
}
const lines = Array.isArray(answer) ? answer : answer.lines;
for (const line of lines) process.stdout.write(`${JSON.stringify(line)}\n`);
process.exitCode = Array.isArray(answer) ? (lines.some((line) => FAILED.test(line.event)) ? 1 : 0) : answer.code;
