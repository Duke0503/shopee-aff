/**
 * The cutover import (AD-24, FR-33): reads a read-only copy of the live ledger and writes a
 * fresh ledger in the new schema, then reports.
 *
 * Configuration refusals come first and touch nothing: no LIVE_LEDGER_PATH (so the production
 * file check can never be skipped), a missing or short fingerprint key, an existing target, a
 * target that is the live file. The run then never reads a row from the live production file or
 * a source opened writable, refuses a live time column without a conversion rule, and stops
 * before writing when two live rows share a Zalo id or a code (duplicate_identity).
 *
 * The new ledger is built in `<target>.partial` and renamed into place only when everything
 * succeeded; on any failure the partial files are deleted, so a retry starts clean. From the
 * moment the source is opened, `<target>.import-report.json` is written whatever the outcome,
 * with the reason on failure. The run imports identity (Story 2.2), orders (Story 2.3), link
 * requests, share codes and products with the keys of notifications the live system already
 * sent (Story 2.5), and campaigns, awards and payouts with their paid parity (Story 2.4), all in
 * one transaction, each module's import writing its audit entry (Story 3.2).
 */
import { existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { Clock } from "@cashback/core";
import type BetterSqlite3 from "better-sqlite3";

import { lastFour } from "../modules/identity/index";
import { openLedger } from "../platform/db/ledger";
import { MIGRATIONS_DIR, readMigrations, runMigrations } from "../platform/db/migrations";
import type { Logger } from "../platform/log/logger";
import { emptyReport, type ImportReport } from "./import-report";
import { fillReport, finishedLine, readLive, writeLive, type LiveData } from "./import-steps";
import { openLiveCopy, samePath, type SourceOpener } from "./live-source";
import { assertEveryTimeColumnHasRule, CutoverRefusedError } from "./live-time";

export const FINGERPRINT_KEY_MIN_LENGTH = 32;

export interface CutoverImportOptions {
  sourcePath: string;
  targetPath: string;
  fingerprintKey: string | null;
  liveLedgerPath: string | null;
  clock: Clock;
  logger: Logger;
  migrationsDir?: string;
  openSource?: SourceOpener;
}

export const reportPathFor = (targetPath: string): string => `${targetPath}.import-report.json`;
export const partialPathFor = (targetPath: string): string => `${targetPath}.partial`;

interface Checked {
  fingerprintKey: string;
  liveLedgerPath: string;
}

function refuseBeforeOpening(options: CutoverImportOptions): Checked {
  const live = options.liveLedgerPath;
  if (live === null || !isAbsolute(live)) throw new CutoverRefusedError("live_ledger_path_missing", "LIVE_LEDGER_PATH (absolute) must be set so the import can refuse the live production file");
  const key = options.fingerprintKey;
  if (key === null || key === "") throw new CutoverRefusedError("fingerprint_key_missing", "FINGERPRINT_KEY is required for bank account fingerprints");
  if (key.length < FINGERPRINT_KEY_MIN_LENGTH) throw new CutoverRefusedError("fingerprint_key_too_short", `FINGERPRINT_KEY must be at least ${FINGERPRINT_KEY_MIN_LENGTH} characters`);
  if (existsSync(options.targetPath)) throw new CutoverRefusedError("target_exists", `the new ledger must be a fresh file: ${options.targetPath}`);
  if (samePath(options.targetPath, live)) throw new CutoverRefusedError("live_production_file", `refusing to write over the live production ledger: ${options.targetPath}`);
  return { fingerprintKey: key, liveLedgerPath: live };
}

function removePartial(path: string): void {
  for (const file of [path, `${path}-wal`, `${path}-shm`, `${path}-journal`]) rmSync(file, { force: true });
}

/** Migrates the partial ledger, imports everything in one `tx`, fills the report, leaves one closed file. */
function writeLedger(partial: string, live: LiveData, source: BetterSqlite3.Database, checked: Checked, options: CutoverImportOptions, report: ImportReport): void {
  const ledger = openLedger(partial);
  try {
    runMigrations(ledger, readMigrations(options.migrationsDir ?? MIGRATIONS_DIR), options.clock);
    const written = writeLive(ledger, live, checked.fingerprintKey, options.clock);
    fillReport(report, live, written, source, ledger.sqlite);
    for (const b of live.identity.bankAccounts) options.logger.info({ lastFour: lastFour(b.accountNumber), consent: b.consentAt !== null }, "cutover.bank_account.imported");
    options.logger.info(finishedLine(report, written), "cutover.import.finished");
    // One self-contained file to rename: no -wal or -shm left beside it.
    ledger.sqlite.pragma("journal_mode = DELETE");
  } finally {
    ledger.close();
  }
}

function importInto(partial: string, checked: Checked, options: CutoverImportOptions, report: ImportReport): void {
  const source = openLiveCopy(options.sourcePath, { liveLedgerPath: checked.liveLedgerPath, open: options.openSource });
  try {
    assertEveryTimeColumnHasRule(source);
    options.logger.info({ step: "read" }, "cutover.import.started");
    writeLedger(partial, readLive(source, report), source, checked, options, report);
  } finally {
    source.close();
  }
}

const reasonOf = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "failed";
};

/** Runs the import; throws on refusal or failure, after writing the report once the source was reached. */
export function runCutoverImport(options: CutoverImportOptions): ImportReport {
  const checked = refuseBeforeOpening(options);
  const partial = partialPathFor(options.targetPath);
  const report = emptyReport();
  removePartial(partial);
  try {
    importInto(partial, checked, options, report);
    renameSync(partial, options.targetPath);
    report.outcome = { ok: true, reason: null, error: null };
    return report;
  } catch (error) {
    removePartial(partial);
    report.outcome = { ok: false, reason: reasonOf(error), error: error instanceof Error ? error.message : String(error) };
    options.logger.error({ reason: report.outcome.reason }, "cutover.import.failed");
    throw error;
  } finally {
    writeFileSync(reportPathFor(options.targetPath), `${JSON.stringify(report, null, 2)}\n`);
  }
}
