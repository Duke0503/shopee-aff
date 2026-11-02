/**
 * The restore drill record (AD-26, D36, Story 8.6): the manual drill runs at cutover and once a
 * quarter, and its last outcome is kept in `data/<env>/backups/restore-drill.json`, written by
 * `pnpm restore:drill-record` on the machine whose health it belongs to (production, even when the
 * drill itself ran on a dev machine). The full drill log, with every drill, is the table in
 * docs/operations/restore-runbook.md; this file holds only what the health model needs.
 *
 * Health: up while the last drill passed less than a quarter (92 days) ago; `due` (a reminder, not
 * an outage) when no
 * drill was ever recorded, when the last one failed, or when it is older than a quarter. Written
 * whole to a temporary file and renamed, like backup-status.json; an unreadable file counts as no
 * drill recorded, so a broken record shows the drill as due, never as done.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseInstant, toMs, type Instant } from "@cashback/core";

export const DRILL_RESULTS = ["pass", "fail"] as const;
export type DrillResult = (typeof DRILL_RESULTS)[number];

export interface DrillRecord {
  /** When the drill started. */
  readonly at: Instant;
  readonly durationMinutes: number;
  readonly result: DrillResult;
  /** The archive the drill restored, by name only. */
  readonly archive: string | null;
}

/** A quarter: 92 days, the longest three consecutive months. */
export const DRILL_DUE_AFTER_MS = 92 * 86_400_000;

/** Raised once when the drill falls due (a reminder, not an outage: the heartbeat ignores it). */
export const RESTORE_DRILL_ALERT = { kind: "restore_drill_due", severity: "warning" } as const;

export interface DrillHealth {
  readonly state: "up" | "due";
  /** The last drill, or null when none was recorded. */
  readonly at: Instant | null;
  readonly alert: typeof RESTORE_DRILL_ALERT | null;
}

export const drillRecordPath = (dataDir: string): string => join(dataDir, "backups", "restore-drill.json");

export function readDrillRecord(path: string): DrillRecord | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const result = (DRILL_RESULTS as readonly unknown[]).includes(raw["result"]) ? (raw["result"] as DrillResult) : null;
    const minutes = raw["durationMinutes"];
    if (typeof raw["at"] !== "string" || result === null || typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 0) return null;
    return { at: parseInstant(raw["at"]), durationMinutes: minutes, result, archive: typeof raw["archive"] === "string" ? raw["archive"] : null };
  } catch {
    return null;
  }
}

export function writeDrillRecord(path: string, record: DrillRecord): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.writing`;
  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(temporary, path);
}

export function drillHealth(record: DrillRecord | null, now: Instant): DrillHealth {
  if (record === null) return { state: "due", at: null, alert: RESTORE_DRILL_ALERT };
  const due = record.result === "fail" || toMs(now) - toMs(record.at) > DRILL_DUE_AFTER_MS;
  return { state: due ? "due" : "up", at: record.at, alert: due ? RESTORE_DRILL_ALERT : null };
}

/** The drill's health at each call, read from its record file. */
export const lastDrillOf =
  (dataDir: string) =>
  (now: Instant): DrillHealth =>
    drillHealth(readDrillRecord(drillRecordPath(dataDir)), now);
