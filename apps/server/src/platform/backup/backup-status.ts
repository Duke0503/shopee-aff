/**
 * What the last backup run left behind (AD-26, AD-27, Story 8.2), kept in
 * `data/<env>/backups/backup-status.json` so the Overview and the health check still know the last
 * good backup after a restart (job outcomes are log lines, AD-13; this is the one fact the health
 * model needs from them). Written whole to a temporary file and renamed, so a reader never sees
 * half of it; a missing or unreadable file means "not known yet".
 *
 * Health: down when the last run failed (locally or off-site) or the last good copy is older than
 * 26 hours (a daily run was missed), with the time of the last good copy; up otherwise; unknown
 * before the first run.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseInstant, toMs, type Instant } from "@cashback/core";

export const BACKUP_OUTCOMES = ["ok", "offsite_skipped", "local_failed", "offsite_failed"] as const;
export type BackupOutcome = (typeof BACKUP_OUTCOMES)[number];

export interface BackupStatus {
  readonly lastGoodAt: Instant | null;
  readonly lastGoodArchive: string | null;
  readonly lastOffsiteAt: Instant | null;
  readonly lastRunAt: Instant | null;
  readonly lastOutcome: BackupOutcome | null;
  /** The step that failed in the last run, or null. */
  readonly failedStep: string | null;
  /** Files under `files/` the last good archive left out for an unsafe name (logged once per run). */
  readonly skippedFiles: number;
}

export const NO_BACKUP_YET: BackupStatus = { lastGoodAt: null, lastGoodArchive: null, lastOffsiteAt: null, lastRunAt: null, lastOutcome: null, failedStep: null, skippedFiles: 0 };

/** A daily run that has not left a good copy for this long counts as missed. */
export const BACKUP_STALE_AFTER_MS = 26 * 3_600_000;

/** The owner alerts of a failed backup (AD-26: any failure is a high alert). */
export const BACKUP_ALERTS = {
  local: { kind: "backup_failed", severity: "high" },
  offsite: { kind: "backup_offsite_failed", severity: "high" },
} as const;

export type BackupAlert = (typeof BACKUP_ALERTS)[keyof typeof BACKUP_ALERTS];

export interface BackupHealth {
  readonly state: "up" | "down" | "unknown";
  /** The last good local copy. */
  readonly at: Instant | null;
  /** The alert the health check raises while it is down. */
  readonly alert: BackupAlert | null;
}

export const backupStatusPath = (dataDir: string): string => join(dataDir, "backups", "backup-status.json");

const instantOrNull = (value: unknown): Instant | null => {
  if (typeof value !== "string") return null;
  try {
    return parseInstant(value);
  } catch {
    return null;
  }
};

export function readBackupStatus(path: string): BackupStatus {
  if (!existsSync(path)) return NO_BACKUP_YET;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const outcome = (BACKUP_OUTCOMES as readonly unknown[]).includes(raw["lastOutcome"]) ? (raw["lastOutcome"] as BackupOutcome) : null;
    return {
      lastGoodAt: instantOrNull(raw["lastGoodAt"]),
      lastGoodArchive: typeof raw["lastGoodArchive"] === "string" ? raw["lastGoodArchive"] : null,
      lastOffsiteAt: instantOrNull(raw["lastOffsiteAt"]),
      lastRunAt: instantOrNull(raw["lastRunAt"]),
      lastOutcome: outcome,
      failedStep: typeof raw["failedStep"] === "string" ? raw["failedStep"] : null,
      skippedFiles: typeof raw["skippedFiles"] === "number" && Number.isInteger(raw["skippedFiles"]) ? raw["skippedFiles"] : 0,
    };
  } catch {
    return NO_BACKUP_YET;
  }
}

export function writeBackupStatus(path: string, status: BackupStatus): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.writing`;
  writeFileSync(temporary, `${JSON.stringify(status, null, 2)}\n`);
  renameSync(temporary, path);
}

export function backupHealth(status: BackupStatus, now: Instant): BackupHealth {
  if (status.lastOutcome === null) return { state: "unknown", at: null, alert: null };
  const at = status.lastGoodAt;
  if (status.lastOutcome === "local_failed") return { state: "down", at, alert: BACKUP_ALERTS.local };
  if (at === null || toMs(now) - toMs(at) > BACKUP_STALE_AFTER_MS) return { state: "down", at, alert: BACKUP_ALERTS.local };
  if (status.lastOutcome === "offsite_failed") return { state: "down", at, alert: BACKUP_ALERTS.offsite };
  return { state: "up", at, alert: null };
}
