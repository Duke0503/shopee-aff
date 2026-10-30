/**
 * The startup migration gate (AD-26, AD-13, FR-32). A schema change can never lose the
 * ledger: when a migration is pending, a local copy is written to `data/<env>/backups/`
 * and must pass `integrity_check` before the first migration runs. If any migration then
 * fails, the ledger is closed and the pre-migration copy put back, because the migrations
 * before the failing one have already committed. Every failure refuses the start with a
 * coded error; with nothing pending, no backup is taken.
 *
 * A copy that fails its check is kept aside as `.corrupt` and a copy whose write failed is
 * deleted, so `backups/` only ever holds good copies under the plain name. A restore that
 * itself fails is logged as fatal with the backup path, because the ledger then needs a
 * person: the restore is atomic, so the ledger is the migrated-up-to-the-failure file, whole.
 */
import { rmSync } from "node:fs";
import type { Clock } from "@cashback/core";

import type { Logger } from "../log/logger";
import { backupLedger, checkIntegrity, newBackupPath, quarantineBackup, restoreLedgerFile } from "./backup";
import { openLedger, type Ledger } from "./ledger";
import { MigrationFailedError, pendingMigrations, readMigrations, runMigrations } from "./migrations";

export interface MigrationGateOptions {
  ledgerPath: string;
  migrationsDir: string;
  backupsDir: string;
  clock: Clock;
  logger: Logger;
  /** Writes the pre-migration copy; tests replace it to produce a damaged or failed copy. */
  backup?: (ledger: Ledger, target: string) => Promise<void>;
  /** Puts the copy back; tests replace it to make the restore fail. */
  restore?: (backup: string, ledgerPath: string) => void;
}

export type MigrationGateCode = "backup_failed" | "backup_check_failed" | "migration_failed" | "restore_failed";

export class MigrationGateError extends Error {
  constructor(
    readonly code: MigrationGateCode,
    message: string,
    readonly migration: string | null = null,
    readonly backup: string | null = null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MigrationGateError";
  }
}

async function writeBackup(ledger: Ledger, target: string, options: MigrationGateOptions): Promise<void> {
  try {
    await (options.backup ?? backupLedger)(ledger, target);
  } catch (error) {
    rmSync(target, { force: true });
    options.logger.error({ backup: target, err: error }, "platform.backup.failed");
    throw new MigrationGateError("backup_failed", `pre-migration backup could not be written: ${target}`, null, target, { cause: error });
  }
  options.logger.info({ backup: target }, "platform.backup.written");
}

/** Backs up and checks the copy; throws, leaving the ledger untouched, when either fails. */
async function checkedBackup(ledger: Ledger, options: MigrationGateOptions): Promise<string> {
  const target = newBackupPath(options.backupsDir, options.clock, "pre-migration");
  await writeBackup(ledger, target, options);
  const integrity = checkIntegrity(target);
  if (!integrity.ok) {
    const quarantined = quarantineBackup(target);
    options.logger.error({ backup: quarantined, problems: integrity.problems.slice(0, 10) }, "platform.backup.check_failed");
    throw new MigrationGateError("backup_check_failed", `pre-migration backup failed integrity_check: ${quarantined}`, null, quarantined);
  }
  options.logger.info({ backup: target }, "platform.backup.checked");
  return target;
}

/** Puts the backup back after `failure`; throws the error the start fails with. */
function restoreAfter(failure: MigrationFailedError, backup: string, options: MigrationGateOptions): never {
  options.logger.error({ migration: failure.migration, backup, err: failure }, "platform.migration.failed");
  try {
    (options.restore ?? restoreLedgerFile)(backup, options.ledgerPath);
  } catch (restoreError) {
    options.logger.fatal({ migration: failure.migration, backup, err: restoreError }, "platform.migration.restore_failed");
    const both = new AggregateError([failure, restoreError], `migration ${failure.migration} failed and the restore failed`);
    throw new MigrationGateError("restore_failed", `${failure.message}; restoring ${backup} also failed`, failure.migration, backup, { cause: both });
  }
  options.logger.info({ migration: failure.migration, backup }, "platform.migration.restored");
  throw new MigrationGateError("migration_failed", failure.message, failure.migration, backup, { cause: failure });
}

/** Opens the ledger and brings it to the latest migration behind a checked backup. */
export async function openMigratedLedger(options: MigrationGateOptions): Promise<Ledger> {
  const migrations = readMigrations(options.migrationsDir);
  const ledger = openLedger(options.ledgerPath);
  let backup: string | null = null;
  try {
    const pending = pendingMigrations(ledger, migrations);
    if (pending.length === 0) return ledger;
    backup = await checkedBackup(ledger, options);
    const applied = runMigrations(ledger, migrations, options.clock, pending);
    options.logger.info({ migrations: applied, backup }, "platform.migration.applied");
    return ledger;
  } catch (error) {
    ledger.close();
    if (!(error instanceof MigrationFailedError) || backup === null) throw error;
    return restoreAfter(error, backup, options);
  }
}
