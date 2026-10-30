/**
 * The "rehearse migration" command (AD-2, AD-26): before a deploy, the pending migrations
 * run against a temporary copy of a production backup, never against the live ledger or
 * the backup itself. The copy is checked first, then migrated, and always deleted after.
 * Nothing throws out of it: every outcome is a result, a failure with its reason.
 */
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Clock } from "@cashback/core";

import { checkIntegrity } from "./backup";
import { openLedger } from "./ledger";
import { MigrationFailedError, readMigrations, runMigrations, type Migration } from "./migrations";

export interface RehearsalOptions {
  backupFile: string;
  migrationsDir: string;
  clock: Clock;
}

export type RehearsalFailure = "usage" | "backup_missing" | "backup_check_failed" | "migrations_invalid" | "migration_failed" | "rehearsal_failed";

export type RehearsalResult =
  | { ok: true; applied: string[] }
  /** `failedMigration` names the migration only when `reason` is `migration_failed`. */
  | { ok: false; reason: RehearsalFailure; failedMigration: string | null; error: string };

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const failure = (reason: RehearsalFailure, error: string, failedMigration: string | null = null): RehearsalResult => ({ ok: false, reason, failedMigration, error });

function migrateCopy(copy: string, migrations: readonly Migration[], clock: Clock): RehearsalResult {
  const ledger = openLedger(copy);
  try {
    return { ok: true, applied: runMigrations(ledger, migrations, clock) };
  } catch (error) {
    if (error instanceof MigrationFailedError) return failure("migration_failed", error.message, error.migration);
    return failure("migrations_invalid", messageOf(error));
  } finally {
    ledger.close();
  }
}

function rehearseIn(workDir: string, options: RehearsalOptions): RehearsalResult {
  if (!existsSync(options.backupFile)) return failure("backup_missing", `no such backup file: ${options.backupFile}`);
  const copy = join(workDir, "ledger.sqlite");
  copyFileSync(options.backupFile, copy);
  const integrity = checkIntegrity(copy);
  if (!integrity.ok) return failure("backup_check_failed", `backup failed integrity_check: ${integrity.problems.slice(0, 3).join("; ")}`);
  let migrations: Migration[];
  try {
    migrations = readMigrations(options.migrationsDir);
  } catch (error) {
    return failure("migrations_invalid", messageOf(error));
  }
  return migrateCopy(copy, migrations, options.clock);
}

export function rehearseMigrations(options: RehearsalOptions): RehearsalResult {
  let workDir: string | null = null;
  try {
    workDir = mkdtempSync(join(tmpdir(), "cashback-rehearsal-"));
    return rehearseIn(workDir, options);
  } catch (error) {
    return failure("rehearsal_failed", messageOf(error));
  } finally {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  }
}
