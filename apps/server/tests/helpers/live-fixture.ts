/**
 * A fixture live database for the cutover tests: the live DDL (fixtures/live-schema.sql) with
 * representative fake rows (fixtures/live-rows.sql), written to a temporary file the way an
 * owner's copy of the live ledger would be. The tests then only ever open it read-only.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixedClock, type Clock } from "@cashback/core";
import Database from "better-sqlite3";

import type { ImportReport } from "../../src/cutover/import-report";
import { runCutoverImport, type CutoverImportOptions } from "../../src/cutover/import-run";
import { commandAudit } from "../../src/modules/operations/index";
import type { LedgerDb } from "../../src/platform/db/ledger";
import { createLogger } from "../../src/platform/log/logger";
import type { Actor, CommandAudit } from "../../src/platform/ports/audit.port";

const FIXTURES = fileURLToPath(new URL("../fixtures", import.meta.url));
export const LIVE_SCHEMA_SQL = readFileSync(join(FIXTURES, "live-schema.sql"), "utf8");
export const LIVE_ROWS_SQL = readFileSync(join(FIXTURES, "live-rows.sql"), "utf8");

export const FINGERPRINT_KEY = "k".repeat(40);

export function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Writes a live copy and returns its path; `extraSql` runs after the rows. */
export function buildLiveCopy(options: { rows?: boolean; extraSql?: string } = {}): string {
  const path = join(tempDir("cashback-live-copy-"), "live-copy.sqlite");
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(LIVE_SCHEMA_SQL);
  if (options.rows ?? true) db.exec(LIVE_ROWS_SQL);
  if (options.extraSql) db.exec(options.extraSql);
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
  return path;
}

/** A configured live production path that is not the copy (absolute, need not exist). */
export const LIVE_LEDGER_PATH = join(tmpdir(), "cashback-live-production", "ledger.sqlite");

export const TEST_CLOCK = fixedClock("2026-10-30T07:00:00.000Z");

/** The staff actor of commands tests run by hand. */
export const TEST_ACTOR: Actor = { kind: "staff", id: "admin", role: "ADMIN" };

/** A command's actor and audit port, bound to the test's transaction handle. */
export const auditBy = (db: LedgerDb, clock: Clock = TEST_CLOCK): CommandAudit => commandAudit(db, clock, TEST_ACTOR);

export interface ImportRun {
  report: ImportReport;
  targetPath: string;
  lines: string[];
}

/** Runs the cutover import into a fresh target; the log lines are captured. */
export function importOnce(source: string, overrides: Partial<CutoverImportOptions> = {}): ImportRun {
  const lines: string[] = [];
  const targetPath = overrides.targetPath ?? join(tempDir("cashback-cutover-"), "ledger.sqlite");
  const logger = createLogger({ destination: { write: (line: string) => void lines.push(line) } });
  const report = runCutoverImport({ sourcePath: source, targetPath, fingerprintKey: FINGERPRINT_KEY, liveLedgerPath: LIVE_LEDGER_PATH, clock: TEST_CLOCK, logger, ...overrides });
  return { report, targetPath, lines };
}

/** All rows of a query, read through a read-only connection. */
export function rows(path: string, query: string): unknown[] {
  const db = new Database(path, { readonly: true });
  try {
    return db.prepare(query).all();
  } finally {
    db.close();
  }
}
