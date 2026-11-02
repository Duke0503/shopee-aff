/**
 * The daily backup (AD-26, FR-32, D36, Story 8.2), at 03:00 Vietnam time and once after a start
 * that applied migrations. One run:
 *
 * 1. a checked local archive (checked-archive.ts); a failure raises the high `backup_failed`
 *    alert and ends the run;
 * 2. local retention (30 daily, 12 monthly; backup-retention.ts);
 * 3. the off-site copy: age encrypts the archive into a temporary `.age` file beside it, rclone
 *    copies it to Google Drive, then the same retention runs over the Drive folder. A failure
 *    raises the high `backup_offsite_failed` alert and keeps the local archive; it never stops the
 *    server or a migration. Without an off-site configuration dev skips this step, while
 *    production counts it as failed, so a production with no off-site copy is never silent.
 *
 * Housekeeping never fails a run: before each run the 3 newest `.corrupt` archives are kept and
 * older ones removed, with work folders and `.age` files a stopped run left behind more than a day
 * ago; local retention errors are logged and the off-site copy still runs.
 *
 * Every run writes backup-status.json, which the one health model reads (the Overview line and
 * the health check's alert). The log names files and steps, never the remote or a key.
 */
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { toMs, type Clock } from "@cashback/core";

import type { Ledger } from "../db/ledger";
import type { Logger } from "../log/logger";
import type { AlertPort } from "../ports/alert.port";
import { BACKUP_ALERTS, backupStatusPath, readBackupStatus, writeBackupStatus, type BackupOutcome, type BackupStatus } from "./backup-status";
import { ARCHIVE_SUFFIX, ENCRYPTED_SUFFIX, retainedArchives } from "./backup-retention";
import { WORK_PREFIX, writeCheckedArchive, type CheckedArchiveOptions } from "./checked-archive";
import { OffsiteError, type OffsiteStore } from "./offsite.adapter";

export const dailyBackupDir = (dataDir: string): string => join(dataDir, "backups", "daily");
export const filesDirOf = (dataDir: string): string => join(dataDir, "files");

export interface DailyBackupDeps {
  readonly ledger: Ledger;
  readonly dataDir: string;
  readonly clock: Clock;
  readonly logger: Pick<Logger, "info" | "warn" | "error">;
  readonly alerts: AlertPort;
  /** Null when the env file names no off-site copy. */
  readonly offsite: OffsiteStore | null;
  /** Production: a missing off-site configuration is a failure, not a skip. */
  readonly offsiteRequired: boolean;
  readonly writeCopy?: CheckedArchiveOptions["writeCopy"];
}

export interface DailyBackupRun {
  readonly outcome: BackupOutcome;
  readonly archive: string | null;
  /** Archives deleted by local retention. */
  readonly removedLocal: readonly string[];
  readonly removedOffsite: readonly string[];
}

function record(deps: DailyBackupDeps, patch: Partial<BackupStatus>): void {
  const path = backupStatusPath(deps.dataDir);
  writeBackupStatus(path, { ...readBackupStatus(path), lastRunAt: deps.clock.now(), ...patch });
}

/** Best effort: a retention error is logged and the run goes on to the off-site copy. */
function pruneLocal(deps: DailyBackupDeps, dir: string): string[] {
  try {
    // Only plain archives: a `.age` left by a stopped run is not a local copy.
    const { drop } = retainedArchives(readdirSync(dir).filter((name) => name.endsWith(ARCHIVE_SUFFIX)));
    for (const name of drop) rmSync(join(dir, name), { force: true });
    if (drop.length > 0) deps.logger.info({ removed: drop.length }, "platform.backup.retention_applied");
    return [...drop];
  } catch (error) {
    deps.logger.warn({ err: error }, "platform.backup.retention_failed");
    return [];
  }
}

/** `.corrupt` archives kept for inspection; older ones are removed. */
export const CORRUPT_KEPT = 3;
/** Work folders and `.age` files older than this were left by a stopped run. */
export const LEFTOVER_AFTER_MS = 86_400_000;

/** Best effort, each file on its own: what a failed or stopped run left must not fill the disk. */
function cleanUp(deps: DailyBackupDeps, dir: string): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  const remove = (name: string): void => {
    try {
      rmSync(join(dir, name), { recursive: true, force: true });
    } catch (error) {
      deps.logger.warn({ file: name, err: error }, "platform.backup.cleanup_failed");
    }
  };
  const corrupt = names.filter((n) => n.endsWith(".corrupt")).sort().reverse();
  for (const name of corrupt.slice(CORRUPT_KEPT)) remove(name);
  const now = toMs(deps.clock.now());
  for (const name of names.filter((n) => n.startsWith(WORK_PREFIX) || n.endsWith(ENCRYPTED_SUFFIX))) {
    try {
      if (now - statSync(join(dir, name)).mtimeMs > LEFTOVER_AFTER_MS) remove(name);
    } catch {
      // Gone already.
    }
  }
}

/** Encrypts, uploads and prunes the Drive folder; throws an OffsiteError naming the failed step. */
async function copyOffsite(store: OffsiteStore, archive: string, name: string, signal?: AbortSignal): Promise<string[]> {
  const encrypted = `${archive}${ENCRYPTED_SUFFIX}`;
  try {
    await store.encrypt(archive, encrypted, signal);
    await store.upload(encrypted, `${name}${ENCRYPTED_SUFFIX}`, signal);
  } finally {
    rmSync(encrypted, { force: true });
  }
  const { drop } = retainedArchives((await store.list(signal)).filter((remote) => remote.endsWith(`${ARCHIVE_SUFFIX}${ENCRYPTED_SUFFIX}`)));
  for (const remote of drop) await store.remove(remote, signal);
  return [...drop];
}

async function offsiteStep(deps: DailyBackupDeps, archive: string, name: string, signal?: AbortSignal): Promise<{ outcome: BackupOutcome; removed: string[]; step: string | null }> {
  if (deps.offsite === null) {
    if (!deps.offsiteRequired) return { outcome: "offsite_skipped", removed: [], step: null };
    deps.logger.error({ step: "not_configured" }, "platform.backup.offsite_failed");
    return { outcome: "offsite_failed", removed: [], step: "not_configured" };
  }
  try {
    const removed = await copyOffsite(deps.offsite, archive, name, signal);
    deps.logger.info({ archive: name, removedOffsite: removed.length }, "platform.backup.offsite_copied");
    return { outcome: "ok", removed, step: null };
  } catch (error) {
    const step = error instanceof OffsiteError ? error.step : "offsite";
    deps.logger.error({ step, code: error instanceof OffsiteError ? error.code : null }, "platform.backup.offsite_failed");
    return { outcome: "offsite_failed", removed: [], step };
  }
}

/** One run; whatever goes wrong ends as a recorded failure with its alert, never as a silent job error. */
export async function runDailyBackup(deps: DailyBackupDeps, signal?: AbortSignal): Promise<DailyBackupRun> {
  try {
    return await runSteps(deps, signal);
  } catch (error) {
    deps.logger.error({ step: "unexpected", err: error }, "platform.backup.failed");
    deps.alerts.alert(BACKUP_ALERTS.local.kind, BACKUP_ALERTS.local.severity);
    try {
      record(deps, { lastOutcome: "local_failed", failedStep: "unexpected" });
    } catch {
      // The status file itself cannot be written; the alert above already went out.
    }
    return { outcome: "local_failed", archive: null, removedLocal: [], removedOffsite: [] };
  }
}

async function runSteps(deps: DailyBackupDeps, signal?: AbortSignal): Promise<DailyBackupRun> {
  const dir = dailyBackupDir(deps.dataDir);
  cleanUp(deps, dir);
  const local = await writeCheckedArchive({ ledger: deps.ledger, filesDir: filesDirOf(deps.dataDir), dir, clock: deps.clock, ...(deps.writeCopy ? { writeCopy: deps.writeCopy } : {}) });
  if (!local.ok) {
    deps.logger.error({ step: local.step, problems: local.problems }, "platform.backup.failed");
    record(deps, { lastOutcome: "local_failed", failedStep: local.step });
    deps.alerts.alert(BACKUP_ALERTS.local.kind, BACKUP_ALERTS.local.severity);
    return { outcome: "local_failed", archive: null, removedLocal: [], removedOffsite: [] };
  }
  const name = local.archive.slice(dir.length + 1);
  deps.logger.info({ archive: name, entries: local.entries.length }, "platform.backup.checked");
  if (local.skippedFiles > 0) deps.logger.warn({ skipped: local.skippedFiles }, "platform.backup.files_skipped");
  record(deps, { lastGoodAt: local.at, lastGoodArchive: name, lastOutcome: "ok", failedStep: null, skippedFiles: local.skippedFiles });
  const removedLocal = pruneLocal(deps, dir);
  const offsite = await offsiteStep(deps, local.archive, name, signal);
  record(deps, { lastOutcome: offsite.outcome, failedStep: offsite.step, ...(offsite.outcome === "ok" ? { lastOffsiteAt: deps.clock.now() } : {}) });
  if (offsite.outcome === "offsite_failed") deps.alerts.alert(BACKUP_ALERTS.offsite.kind, BACKUP_ALERTS.offsite.severity);
  return { outcome: offsite.outcome, archive: local.archive, removedLocal, removedOffsite: offsite.removed };
}
