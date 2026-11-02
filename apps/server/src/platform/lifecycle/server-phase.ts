/**
 * What the server is doing while it starts (Story 8.5, review item 7): `run/<env>/server.phase.json`
 * holds its own PID and `starting` from the moment it holds the lock (the pre-migration backup and
 * the migrations can take many minutes, before any listener answers) and `ready` once both
 * listeners answer. The start command waits as long as the PID it started reports `starting`, and
 * never kills a server in that phase. A missing or unreadable file means "not reported".
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const SERVER_PHASES = ["starting", "ready"] as const;
export type ServerPhase = (typeof SERVER_PHASES)[number];

export interface PhaseRecord {
  readonly pid: number;
  readonly phase: ServerPhase;
  readonly at: string;
}

export const phaseFilePath = (runDir: string): string => join(runDir, "server.phase.json");

/** Written whole and renamed; a failure to write never stops the server. */
export function writeServerPhase(path: string, record: PhaseRecord): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.writing`, `${JSON.stringify(record)}\n`);
    renameSync(`${path}.writing`, path);
    return true;
  } catch {
    return false;
  }
}

export function readServerPhase(path: string): PhaseRecord | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const phase = (SERVER_PHASES as readonly unknown[]).includes(raw["phase"]) ? (raw["phase"] as ServerPhase) : null;
    if (phase === null || typeof raw["pid"] !== "number" || typeof raw["at"] !== "string") return null;
    return { pid: raw["pid"], phase, at: raw["at"] };
  } catch {
    return null;
  }
}
