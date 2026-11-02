/**
 * The dev start and stop scripts' PID record (Story 8.1 AC2, AD-25, cashback-infra rule 10). The
 * start script writes `run/dev/server.pid` with the PID it started and when; the stop script acts
 * on that PID only, and only while the process behind it is still the one started then: a PID the
 * OS has since given to another process is left alone. Nothing is ever looked up by process name.
 * The stop is ordered first (the server stops itself through its internal shutdown route, so jobs,
 * listeners, ledger and lock close in turn); only a server that has not stopped when the wait ends
 * is killed, reported as `forced`.
 *
 * A live PID whose start time the OS will not tell (on Windows, a process of another logon session
 * or elevation) is `unverified`: never stopped, never treated as free, and its record is kept, so
 * no second process is started beside it (production 2026-11-02: a second Zalo assistant started
 * beside the first one when its start time could not be read).
 * The OS probe is injected, so the rule is tested without touching real processes.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseInstant, toMs, type Clock } from "@cashback/core";
import { z } from "zod";

export const PID_FILE = "server.pid";
/** How far the process's own start may lie from the recorded start and still be the same process. */
export const START_TOLERANCE_MS = 15_000;

/** `run/<env>/server.pid` (RUN_DIR); dev and production never share it (cashback-infra rule 10). */
export const pidFilePath = (runDir: string): string => join(runDir, PID_FILE);

const recordSchema = z.object({ pid: z.number().int().min(1), startedAt: z.string() });
export type PidRecord = z.infer<typeof recordSchema>;

export interface ProcessProbe {
  isAlive(pid: number): boolean;
  /** Seconds since the process started, or null when the OS does not say. */
  elapsedSeconds(pid: number): number | null;
  kill(pid: number): void;
}

export function writePidRecord(path: string, record: PidRecord): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(record)}\n`);
}

export function readPidRecord(path: string): PidRecord | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = recordSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Whether the recorded PID is the process started then: `ours` (alive, started when recorded),
 * `not_ours` (alive, started at another time: the OS reused the PID), `dead`, or `unknown` (alive,
 * but the OS does not say when it started).
 */
export function recordIdentity(record: PidRecord, probe: ProcessProbe, clock: Clock): "ours" | "not_ours" | "dead" | "unknown" {
  if (!probe.isAlive(record.pid)) return "dead";
  const elapsed = probe.elapsedSeconds(record.pid);
  if (elapsed === null) return "unknown";
  const started = toMs(clock.now()) - elapsed * 1000;
  return Math.abs(started - toMs(parseInstant(record.startedAt))) <= START_TOLERANCE_MS ? "ours" : "not_ours";
}

/** True when `record.pid` is alive and started when the record says. */
export function isRecordedProcess(record: PidRecord, probe: ProcessProbe, clock: Clock): boolean {
  return recordIdentity(record, probe, clock) === "ours";
}

export type StopOutcome = "stopped" | "forced" | "nothing_recorded" | "not_running" | "not_ours" | "unverified";

/** The ordered stop the server offers (its internal shutdown route), and how long to wait for it. */
export interface GracefulStop {
  /** Asks the server to stop itself; false when it could not be asked. */
  request(): Promise<boolean>;
  readonly waitMs: number;
  readonly pollMs?: number;
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function stoppedWithin(pid: number, probe: ProcessProbe, waitMs: number, pollMs: number): Promise<boolean> {
  for (let waited = 0; waited < waitMs; waited += pollMs) {
    if (!probe.isAlive(pid)) return true;
    await pause(pollMs);
  }
  return !probe.isAlive(pid);
}

/**
 * Stops the recorded process when it is still ours: first by its ordered stop, then, if it is
 * still running when the wait ends (or could not be asked), by a kill reported as `forced`. The
 * record is removed in every case but a failed kill.
 */
export async function stopRecorded(path: string, probe: ProcessProbe, clock: Clock, graceful?: GracefulStop): Promise<{ outcome: StopOutcome; pid: number | null }> {
  const record = readPidRecord(path);
  if (record === null) {
    rmSync(path, { force: true });
    return { outcome: "nothing_recorded", pid: null };
  }
  if (!probe.isAlive(record.pid)) {
    rmSync(path, { force: true });
    return { outcome: "not_running", pid: record.pid };
  }
  const identity = recordIdentity(record, probe, clock);
  if (identity === "unknown") return { outcome: "unverified", pid: record.pid };
  if (identity !== "ours") {
    rmSync(path, { force: true });
    return { outcome: "not_ours", pid: record.pid };
  }
  if (graceful !== undefined && (await graceful.request().catch(() => false)) && (await stoppedWithin(record.pid, probe, graceful.waitMs, graceful.pollMs ?? 100))) {
    rmSync(path, { force: true });
    return { outcome: "stopped", pid: record.pid };
  }
  probe.kill(record.pid);
  rmSync(path, { force: true });
  return { outcome: "forced", pid: record.pid };
}

/** `[[dd-]hh:]mm:ss` from `ps -o etime=`. */
export function parseEtime(text: string): number | null {
  const match = /^\s*(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)\s*$/.exec(text);
  if (!match) return null;
  const [, d, h, m, s] = match;
  return Number(d ?? 0) * 86_400 + Number(h ?? 0) * 3_600 + Number(m) * 60 + Number(s);
}

/**
 * The process's age on Windows: Get-Process's StartTime needs a handle to the process, which
 * Windows refuses across logon sessions and elevation (a task's S4U process asking about one started
 * from an elevated console); WMI's CreationDate needs none, so it is the fallback.
 */
export const WINDOWS_ELAPSED_SCRIPT = (pid: number): string =>
  `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; $t = if ($p) { $p.StartTime }; ` +
  `if ($null -eq $t) { $t = (Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue).CreationDate }; ` +
  `if ($null -ne $t) { [int]((Get-Date) - $t).TotalSeconds }`;

function elapsedOnThisOs(pid: number): number | null {
  try {
    if (process.platform === "win32") {
      const script = WINDOWS_ELAPSED_SCRIPT(pid);
      const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const text = out.trim();
      const seconds = Number(text);
      return text !== "" && Number.isInteger(seconds) ? seconds : null;
    }
    return parseEtime(execFileSync("ps", ["-o", "etime=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return null;
  }
}

export const osProcessProbe: ProcessProbe = {
  isAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EPERM";
    }
  },
  elapsedSeconds: elapsedOnThisOs,
  kill: (pid) => void process.kill(pid, "SIGTERM"),
};
