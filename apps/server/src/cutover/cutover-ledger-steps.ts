/**
 * The cutover steps that read or write a whole ledger (Stories 8.7, 8.8): where the server of an
 * environment keeps its ledger, the numbers audit, the two cutover flags, the go-live start of
 * the no-payout window, and installing the imported ledger. The writing steps run only while the
 * server of that ledger is stopped (the scripts stop it first; the server lock refuses otherwise).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { systemClock } from "@cashback/core";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { isSilent } from "../modules/messaging/index";
import { commandAudit } from "../modules/operations/index";
import { openPayoutWindow, payoutWindow } from "../modules/payouts/index";
import { loadConfigFor, type Environment } from "../platform/config/env.config";
import { LEDGER_FILE, openLedger } from "../platform/db/ledger";
import { CUTOVER_SYSTEM_ACTOR } from "../platform/ports/audit.port";
import { auditMarkdown, runAudit } from "./audit-report";
import { readImportReport, withBoth, type StepAnswer } from "./cutover-steps";
import { sha256Of } from "./live-backup";

/** The ledger file the server of `env` opens: the one path every script uses. */
export const ledgerPathOf = (env: Environment): string => join(loadConfigFor(env).dataDir, LEDGER_FILE);

export function ledgerPathStep(env: Environment): StepAnswer {
  return { line: { step: "ledger-path", env, ledger: ledgerPathOf(env) }, code: 0 };
}

/** The numbers audit into `outDir` (audit.json, audit.md); exit 1 on any unexplained difference. */
export function auditStep(liveCopy: string, newLedger: string, outDir: string): StepAnswer {
  const report = readImportReport(newLedger);
  if (report === null) return { line: { step: "audit", result: "fail", reason: "import_report_missing" }, code: 1 };
  const audit = withBoth(liveCopy, newLedger, (source, target) => runAudit(source, target, report));
  writeFileSync(join(outDir, "audit.json"), `${JSON.stringify(audit, null, 2)}\n`);
  writeFileSync(join(outDir, "audit.md"), auditMarkdown(audit, systemClock.now()));
  const line = { step: "audit", result: audit.result, unexplained: audit.unexplained, explained: audit.explained, orders: audit.orders.checked, payouts: audit.payouts.checked, customers: audit.customers.checked, batches: audit.batches.checked, totals: audit.customers.totals };
  return { line, code: audit.result === "pass" ? 0 : 1 };
}

/** The ledger's two cutover flags, read-only. Exit 0 only while both are on. */
export function flagsStep(ledgerPath: string): StepAnswer {
  const sqlite = new Database(ledgerPath, { readonly: true, fileMustExist: true });
  try {
    const db = drizzle({ client: sqlite });
    const window = payoutWindow(db);
    const silent = isSilent(db);
    return { line: { step: "flags", messagingSilent: silent, payoutWindowOpen: window.open, payoutWindowEndsAt: window.endsAt }, code: silent && window.open ? 0 : 1 };
  } finally {
    sqlite.close();
  }
}

/**
 * Go-live: the no-payout window starts now, on the installed ledger, before the server starts, so
 * the window and the rollback share one clock (72 hours from go-live). Audited under the cutover.
 */
export function goLiveStep(ledgerPath: string): StepAnswer {
  const ledger = openLedger(ledgerPath);
  try {
    const now = systemClock.now();
    const window = ledger.tx((db) => openPayoutWindow(db, now, commandAudit(db, systemClock, CUTOVER_SYSTEM_ACTOR)));
    return { line: { step: "go-live", goLiveAt: now, payoutWindowEndsAt: window.endsAt }, code: 0 };
  } finally {
    ledger.close();
  }
}

const MARKER = ".installed.json";

/**
 * Puts the imported ledger where the server of `env` opens it, by the SQLite backup API (the
 * result carries no WAL). Only the ledger file changes: a ledger already there is moved aside with
 * its `-wal` and `-shm` (a stale WAL must never meet the new file), never deleted, and everything
 * else in the data folder (proof files, backups, logs) stays. The same ledger installed twice is a
 * no-op, by the source hash the marker records.
 */
export async function installLedgerStep(newLedger: string, target: string): Promise<StepAnswer> {
  const hash = sha256Of(newLedger);
  const marker = `${target}${MARKER}`;
  const installed = existsSync(marker) && existsSync(target) ? (JSON.parse(readFileSync(marker, "utf8")) as { source?: string }).source : undefined;
  if (installed === hash) return { line: { step: "install-ledger", target, sourceSha256: hash, movedAside: null, reused: true }, code: 0 };
  let movedAside: string | null = null;
  if (existsSync(target)) {
    movedAside = `${target}.pre-cutover-${systemClock.now().replace(/[:.]/g, "-")}`;
    renameSync(target, movedAside);
    for (const suffix of ["-wal", "-shm"]) if (existsSync(`${target}${suffix}`)) renameSync(`${target}${suffix}`, `${movedAside}${suffix}`);
  }
  for (const suffix of ["-wal", "-shm"]) rmSync(`${target}${suffix}`, { force: true });
  mkdirSync(dirname(target), { recursive: true });
  const source = new Database(newLedger, { readonly: true, fileMustExist: true });
  try {
    await source.backup(target);
  } finally {
    source.close();
  }
  writeFileSync(marker, `${JSON.stringify({ source: hash })}\n`);
  return { line: { step: "install-ledger", target, sourceSha256: hash, movedAside, reused: false }, code: 0 };
}
