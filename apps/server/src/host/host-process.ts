/**
 * The production host's processes (AD-25, D61, Story 8.5): the server, the Zalo assistant and the
 * affiliate Edge, each started by `pnpm host start <role>` (the Task Scheduler tasks of
 * ops/windows/ run exactly that) and stopped by `pnpm host stop <role>`, acting only on the PID
 * it recorded in `run/<env>/<role>.pid` and only while that PID still belongs to the process
 * started then (platform/lifecycle/dev-process.ts). Nothing is found or stopped by process name, so
 * the live system's `CashbackBackend` and `CashbackAssistant` tasks and the live browser beside
 * them are never touched.
 *
 * A start is idempotent: a role whose recorded process is still running reports
 * `already_running` and starts nothing. The tasks run `pnpm host run <role>` (`runRecorded`), which
 * stays running as long as the process it started, so a task's repeating trigger, ignored while it
 * runs, restarts only a role that died. The server counts as started once its health route
 * answers: it gets 60 seconds after it last reported the phase `starting`
 * (platform/lifecycle/server-phase.ts), and up to 30 minutes while it keeps reporting it (the
 * pre-migration backup and the migrations), and it is never killed in that phase: past 30 minutes
 * it is recorded and reported `started` with `pending`. The assistant and Edge count as started
 * once they are still alive after a short wait (an Edge that hands its window to an Edge already
 * running on the same profile exits at once and is reported `failed`).
 *
 * Edge runs with its own profile (BROWSER_PROFILE_DIR) and the new bridge extension
 * (apps/bridge/dist) and with the flags that stop it throttling a window no one looks at; the OS
 * calls are injected so every rule here is tested without starting a process.
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Clock } from "@cashback/core";

import type { ServerConfig } from "../platform/config/env.config";
import { isRecordedProcess, readPidRecord, writePidRecord, type ProcessProbe } from "../platform/lifecycle/dev-process";

export const HOST_ROLES = ["server", "assistant", "browser"] as const;
export type HostRole = (typeof HOST_ROLES)[number];

/** Start order; stop runs it backwards. */
export const START_ORDER: readonly HostRole[] = HOST_ROLES;

export const pidFileOf = (runDir: string, role: HostRole): string => join(runDir, `${role}.pid`);

/** The custom link page the bridge works on (apps/bridge/src/shopee-page.ts). */
export const AFFILIATE_START_URL = "https://affiliate.shopee.vn/offer/custom_link";

/** Where Windows installs Edge; the first that exists is used unless `--edge` names one. */
export const EDGE_CANDIDATES = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"] as const;

export function findEdge(candidates: readonly string[], exists: (path: string) => boolean = existsSync): string | null {
  return candidates.find((path) => exists(path)) ?? null;
}

/** Edge's own profile, the new extension only, and no throttling of a window nobody watches. */
export function edgeArgs(profileDir: string, extensionDir: string): string[] {
  return [
    `--user-data-dir=${profileDir}`,
    `--load-extension=${extensionDir}`,
    `--disable-extensions-except=${extensionDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-features=CalculateNativeWinOcclusion",
    AFFILIATE_START_URL,
  ];
}

export interface LaunchSpec {
  readonly role: HostRole;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /** The log file the process writes to, or null (Edge keeps its own). */
  readonly log: string | null;
  /** `health`: the server's health route answers; `alive`: still running after the wait. */
  readonly ready: "health" | "alive";
}

export interface LaunchPaths {
  readonly repositoryRoot: string;
  /** The Node executable that runs this command. */
  readonly node: string;
  readonly edge: string | null;
}

export class HostLaunchError extends Error {
  constructor(readonly reason: "edge_not_found" | "extension_not_built" | "no_browser_profile") {
    super(`host: ${reason}`);
    this.name = "HostLaunchError";
  }
}

/** How each role is started, from the env file's folders; throws HostLaunchError when Edge cannot be. */
export function launchSpec(role: HostRole, config: Pick<ServerConfig, "dataDir" | "browserProfileDir">, paths: LaunchPaths, exists: (path: string) => boolean = existsSync): LaunchSpec {
  const logs = join(config.dataDir, "logs");
  if (role === "server") {
    const dir = join(paths.repositoryRoot, "apps", "server");
    return { role, command: paths.node, args: ["--import", "tsx", join(dir, "src", "main.ts")], cwd: dir, log: join(logs, "server.log"), ready: "health" };
  }
  if (role === "assistant") {
    const dir = join(paths.repositoryRoot, "apps", "assistant");
    return { role, command: paths.node, args: ["--import", "tsx", join(dir, "src", "main.ts")], cwd: dir, log: join(logs, "assistant.log"), ready: "alive" };
  }
  const extension = join(paths.repositoryRoot, "apps", "bridge", "dist");
  if (config.browserProfileDir === null) throw new HostLaunchError("no_browser_profile");
  if (!exists(join(extension, "manifest.json"))) throw new HostLaunchError("extension_not_built");
  if (paths.edge === null) throw new HostLaunchError("edge_not_found");
  return { role, command: paths.edge, args: edgeArgs(config.browserProfileDir, extension), cwd: config.browserProfileDir, log: null, ready: "alive" };
}

export type HostState = "running" | "not_running" | "nothing_recorded" | "not_ours";

/** What the recorded PID of a role is now; `not_ours` when the OS gave the PID to another process. */
export function recordedState(pidFile: string, probe: ProcessProbe, clock: Clock): { state: HostState; pid: number | null; startedAt: string | null } {
  const record = readPidRecord(pidFile);
  if (record === null) return { state: "nothing_recorded", pid: null, startedAt: null };
  if (!probe.isAlive(record.pid)) return { state: "not_running", pid: record.pid, startedAt: record.startedAt };
  return { state: isRecordedProcess(record, probe, clock) ? "running" : "not_ours", pid: record.pid, startedAt: record.startedAt };
}

/** A started child as the start needs it. */
export interface Launched {
  readonly pid: number | undefined;
  /** True once the process has exited (or failed to spawn). */
  exited(): boolean;
  /** Resolves with the exit code once the process has exited. */
  exitCode(): Promise<number | null>;
  kill(): void;
}

export interface StartDeps {
  readonly pidFile: string;
  readonly probe: ProcessProbe;
  readonly clock: Clock;
  readonly launch: (spec: LaunchSpec) => Launched;
  /** Resolves with null when the child is ready, or why it is not and whether it may be killed. */
  readonly ready: (spec: LaunchSpec, child: Launched) => Promise<NotReady | null>;
}

export interface NotReady {
  readonly reason: string;
  /** False while the server reports it is starting: a backup or a migration is never cut short. */
  readonly kill: boolean;
}

/** How long a server that answers nothing may take, counted from when it last reported `starting`. */
export const READY_WAIT_MS = 60_000;
/** The upper bound while it keeps reporting `starting` (pre-migration backup and migrations). */
export const STARTING_WAIT_MS = 30 * 60_000;

export interface ServerWait {
  healthy(): Promise<boolean>;
  /** True while the started PID reports the phase `starting`. */
  starting(): boolean;
  exited(): boolean;
  now(): number;
  pause(ms: number): Promise<void>;
  readonly pollMs: number;
}

/** Waits for the server's health route (see the module comment for the bounds). */
export async function waitForServer(wait: ServerWait): Promise<NotReady | null> {
  const began = wait.now();
  let lastStarting = began;
  for (;;) {
    if (wait.exited()) return { reason: "exited (see server.log)", kill: false };
    if (await wait.healthy()) return null;
    const now = wait.now();
    if (wait.starting()) {
      lastStarting = now;
      if (now - began >= STARTING_WAIT_MS) return { reason: "still_starting", kill: false };
    } else if (now - lastStarting >= READY_WAIT_MS) return { reason: "not_healthy", kill: true };
    await wait.pause(wait.pollMs);
  }
}

export type StartOutcome = { readonly outcome: "started"; readonly pid: number; readonly pending?: string } | { readonly outcome: "already_running"; readonly pid: number } | { readonly outcome: "failed"; readonly reason: string };

/**
 * Starts `spec` unless its recorded process still runs. The PID is recorded only once the child is
 * ready; a child that is not is killed (it is the PID this call just started) and nothing is recorded,
 * unless it may not be killed (a server still starting): then it is recorded and `pending` says why.
 */
export async function startRecorded(spec: LaunchSpec, deps: StartDeps): Promise<StartOutcome> {
  const now = recordedState(deps.pidFile, deps.probe, deps.clock);
  if (now.state === "running" && now.pid !== null) return { outcome: "already_running", pid: now.pid };
  const startedAt = deps.clock.now();
  const child = deps.launch(spec);
  const notReady = await deps.ready(spec, child);
  if (child.pid === undefined) return { outcome: "failed", reason: notReady?.reason ?? "no_pid" };
  if (notReady !== null && (notReady.kill || child.exited())) {
    if (notReady.kill && !child.exited()) child.kill();
    return { outcome: "failed", reason: notReady.reason };
  }
  writePidRecord(deps.pidFile, { pid: child.pid, startedAt });
  return notReady === null ? { outcome: "started", pid: child.pid } : { outcome: "started", pid: child.pid, pending: notReady.reason };
}

export type RunOutcome = Exclude<StartOutcome, { outcome: "started" }> | { readonly outcome: "exited"; readonly pid: number; readonly code: number | null };

/**
 * What a Task Scheduler task runs (`pnpm host run <role>`): the start above, then a wait for the
 * started process to exit, so the task stays running exactly as long as its process. Its record is
 * removed when it exits (unless a later start recorded another PID), and the exit code is passed on,
 * so a crash fails the task and its restart settings apply. A role already running ends at once.
 */
export async function runRecorded(spec: LaunchSpec, deps: StartDeps): Promise<RunOutcome> {
  const holder: { child: Launched | null } = { child: null };
  const result = await startRecorded(spec, { ...deps, launch: (s) => (holder.child = deps.launch(s)) });
  if (result.outcome !== "started" || holder.child === null) return result as RunOutcome;
  const code = await holder.child.exitCode();
  if (readPidRecord(deps.pidFile)?.pid === result.pid) rmSync(deps.pidFile, { force: true });
  return { outcome: "exited", pid: result.pid, code };
}
