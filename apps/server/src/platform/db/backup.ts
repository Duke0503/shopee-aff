/**
 * Local ledger backups (AD-26, FR-32), in the form the migration gate and the daily backup
 * (platform/backup) need: a copy taken with SQLite's online backup API, so it is consistent
 * while the ledger is open, then checked with `PRAGMA integrity_check` before anything trusts
 * it, then its row counts must equal the live ledger's at the moment the copy finished (Story
 * 8.2; the daily backup also restores its whole archive into a temporary folder). The copy is switched to a rollback journal so it is one
 * self-contained file, with no -wal or -shm beside it.
 */
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Clock } from "@cashback/core";
import Database from "better-sqlite3";

import type { Ledger } from "./ledger";

export interface IntegrityResult {
  ok: boolean;
  /** `integrity_check` lines, or the error that stopped the file from opening. */
  problems: string[];
}

/**
 * A new file `<backupsDir>/<instant>-<label>.sqlite`; colons become dashes so the name is
 * valid on every OS, and a name already taken gets a counter, so no backup is overwritten.
 */
export function newBackupPath(backupsDir: string, clock: Clock, label: string): string {
  mkdirSync(backupsDir, { recursive: true });
  const stem = `${clock.now().replaceAll(":", "-")}-${label}`;
  for (let n = 1; ; n++) {
    const path = join(backupsDir, n === 1 ? `${stem}.sqlite` : `${stem}-${n}.sqlite`);
    if (!existsSync(path)) return path;
  }
}

/** Writes a consistent copy of the open ledger to `target` with the online backup API. */
export async function backupLedger(ledger: Ledger, target: string): Promise<void> {
  await ledger.sqlite.backup(target);
  const copy = new Database(target, { fileMustExist: true });
  try {
    copy.pragma("journal_mode = DELETE");
  } finally {
    copy.close();
  }
}

/** Rows per table (SQLite's own tables left out), the measure the restore check compares. */
export type RowCounts = Readonly<Record<string, number>>;

export function tableRowCounts(sqlite: Database.Database): RowCounts {
  const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name").all() as { name: string }[];
  return Object.fromEntries(tables.map(({ name }) => [name, (sqlite.prepare(`SELECT count(*) AS n FROM "${name.replaceAll('"', '""')}"`).get() as { n: number }).n]));
}

/**
 * Writes the copy like `backupLedger` and returns the live row counts read the moment the copy
 * finished. The online backup API carries every write made through this connection into the copy,
 * and the counts are read synchronously right after it resolves, so no write falls in between.
 */
export async function snapshotLedger(ledger: Ledger, target: string, write: (ledger: Ledger, target: string) => Promise<void> = backupLedger): Promise<RowCounts> {
  await write(ledger, target);
  return tableRowCounts(ledger.sqlite);
}

/** Each table whose row count differs between `expected` and the database at `path`; empty when they agree. */
export function rowCountMismatches(path: string, expected: RowCounts): string[] {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const actual = tableRowCounts(db);
    const names = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
    return names.filter((name) => expected[name] !== actual[name]).map((name) => `${name}: ${actual[name] ?? "missing"} restored, ${expected[name] ?? "missing"} live`);
  } finally {
    db.close();
  }
}

/** Opens `path` read-only and runs `PRAGMA integrity_check`; any error counts as a failure. */
export function checkIntegrity(path: string): IntegrityResult {
  if (!existsSync(path)) return { ok: false, problems: [`no such file: ${path}`] };
  let db: Database.Database | null = null;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    const lines = (db.pragma("integrity_check") as { integrity_check: string }[]).map((row) => row.integrity_check);
    const ok = lines.length === 1 && lines[0] === "ok";
    return { ok, problems: ok ? [] : lines };
  } catch (error) {
    return { ok: false, problems: [error instanceof Error ? error.message : String(error)] };
  } finally {
    db?.close();
  }
}

/** The ledger's side files; a restore removes them so no newer WAL frames replay over the copy. */
export const sideFiles = (ledgerPath: string): string[] => [`${ledgerPath}-wal`, `${ledgerPath}-shm`, `${ledgerPath}-journal`];

/**
 * Puts `backup` in place of the ledger, which must be closed. The copy goes to a temporary
 * file beside the ledger and is renamed over it, so the ledger is either the old file or
 * the whole backup, never half of one. A failed copy removes the temporary file and throws.
 */
export function restoreLedgerFile(backup: string, ledgerPath: string): void {
  const temporary = `${ledgerPath}.restoring`;
  try {
    copyFileSync(backup, temporary);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
  for (const file of sideFiles(ledgerPath)) rmSync(file, { force: true });
  renameSync(temporary, ledgerPath);
}

/** Moves a backup that failed its check aside as `<name>.corrupt`, so nothing mistakes it for a good copy. */
export function quarantineBackup(path: string): string {
  const target = `${path}.corrupt`;
  renameSync(path, target);
  for (const file of sideFiles(path)) rmSync(file, { force: true });
  return target;
}
