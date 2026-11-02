/**
 * The server-side steps of the cutover script set (ops/windows/cutover/, Stories 8.7 and 8.8),
 * each one JSON line for the PowerShell phase that calls it through `pnpm cutover:step`. They read
 * the env files by path and the ledgers read-only; the backup writes only into its own folder,
 * and the steps that write a ledger are in cutover-ledger-steps.ts. A secret is read from one file
 * and written to another, never returned.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";

import { loadConfigFor, REPOSITORY_ROOT, type Environment } from "../platform/config/env.config";
import { offsiteStore } from "../platform/backup/offsite.adapter";
import { gatherPreflight, preflightVerdict, REQUIRED_BUILDS } from "./cutover-preflight";
import { runGate } from "./cutover-gate";
import { planCarryOver } from "./env-carry-over";
import type { ImportReport } from "./import-report";
import { reportPathFor } from "./import-run";
import { backupLiveLedger } from "./live-backup";
import { runSmoke, smokeSample, type HttpProbe, type SmokeTarget } from "./smoke-check";

export type StepLine = Record<string, unknown>;
export interface StepAnswer {
  readonly line: StepLine;
  readonly code: number;
}

/** A whole number in [min, max] written in digits only, or null: `Number("1e3")` or `" 20"` never pass. */
export function parseWhole(value: string, min: number, max: number): number | null {
  if (!/^\d{1,6}$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

export function preflightStep(liveEnv: string, acceptGaps: readonly string[], mainRef: string | undefined): StepAnswer {
  const verdict = preflightVerdict(gatherPreflight(liveEnv, acceptGaps, mainRef));
  return { line: { step: "preflight", ...verdict }, code: verdict.ok ? 0 : 1 };
}

/** The builds and the installed SQLite binding the new server needs: the one list, for both modes. */
export function buildsStep(root: string = REPOSITORY_ROOT): StepAnswer {
  const missing = REQUIRED_BUILDS.filter((file) => !existsSync(join(root, file)));
  return { line: { step: "builds", missing }, code: missing.length === 0 ? 0 : 1 };
}

/** A backup made anew is encrypted anew: a `.age` left from an earlier backup is removed first. */
export async function backupStep(livePath: string, outDir: string, encryptWith: Environment | null): Promise<StepAnswer> {
  const backup = await backupLiveLedger(livePath, outDir);
  const encrypted = `${backup.file}.age`;
  if (!backup.reused) rmSync(encrypted, { force: true });
  const offsite = encryptWith === null ? null : loadConfigFor(encryptWith).backupOffsite;
  if (offsite && !existsSync(encrypted)) await offsiteStore(offsite).encrypt(backup.file, encrypted);
  const line = { step: "backup", file: backup.file, sha256: backup.sha256, bytes: backup.bytes, integrity: backup.integrity, staged: backup.staged, reused: backup.reused, encrypted: offsite ? encrypted : null };
  return { line, code: 0 };
}

export function readImportReport(newLedger: string): ImportReport | null {
  const reportPath = reportPathFor(newLedger);
  return existsSync(reportPath) ? (JSON.parse(readFileSync(reportPath, "utf8")) as ImportReport) : null;
}

export function withBoth<T>(liveCopy: string, newLedger: string, run: (source: Database.Database, target: Database.Database) => T): T {
  const source = new Database(liveCopy, { readonly: true, fileMustExist: true });
  const target = new Database(newLedger, { readonly: true, fileMustExist: true });
  try {
    return run(source, target);
  } finally {
    source.close();
    target.close();
  }
}

export function gateStep(liveCopy: string, newLedger: string): StepAnswer {
  const verdict = withBoth(liveCopy, newLedger, (source, target) => runGate(source, target, readImportReport(newLedger)));
  return { line: { step: "gate", ...verdict }, code: verdict.result === "pass" ? 0 : 1 };
}

/** `check`: plan only, the production file is not written. */
export function carryOverStep(liveEnv: string, prodEnv: string, fixed: Readonly<Record<string, string>>, check: boolean): StepAnswer {
  const prodText = existsSync(prodEnv) ? readFileSync(prodEnv, "utf8") : "";
  const plan = planCarryOver(readFileSync(liveEnv, "utf8"), prodText, fixed);
  if (!check && plan.text !== prodText) writeFileSync(prodEnv, plan.text);
  const { text: _text, ...keys } = plan;
  return { line: { step: "carry-over", written: !check && plan.text !== prodText, ...keys }, code: 0 };
}

export const httpProbe: HttpProbe = (url, options) =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    const send = target.protocol === "https:" ? httpsRequest : httpRequest;
    const req = send(target, { method: options.method, headers: options.host ? { host: options.host } : {}, timeout: 10_000 }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });

/**
 * Fails when a check fails, when the ledger has no share link to open, or when fewer share links
 * or receipts were sampled than asked for and available.
 */
export async function smokeStep(ledgerPath: string, targets: readonly SmokeTarget[], sampleSize: number, probe: HttpProbe = httpProbe): Promise<StepAnswer> {
  const db = new Database(ledgerPath, { readonly: true, fileMustExist: true });
  const sample = smokeSample(db, sampleSize);
  db.close();
  const result = await runSmoke(targets, sample, probe);
  const short = sample.codes.length < Math.min(sampleSize, sample.available.shareCodes) || sample.tokens.length < Math.min(sampleSize, sample.available.receipts);
  const problems = [...(sample.available.shareCodes === 0 ? ["no_share_code"] : []), ...(short ? ["sample_short"] : [])];
  const ok = result.ok && problems.length === 0;
  return { line: { step: "smoke", ...result, ok, available: sample.available, problems }, code: ok ? 0 : 1 };
}

const token = (): string => randomBytes(32).toString("base64url");

/**
 * The rehearsal's own dev env file under a home folder of its own: new random tokens and key, its
 * own ports, data and run folders, fake bridge and Zalo, so the rehearsal reaches no network,
 * Zalo or Telegram. The live ledger path is the one the scripts know, so the import refuses it.
 * Kept when it exists, so a resumed rehearsal keeps its fingerprint key.
 */
export function rehearsalEnvStep(home: string, work: string, port: number, liveLedger: string): StepAnswer {
  const file = join(home, ".config", "cashback", "dev.env");
  if (existsSync(file)) return { line: { step: "rehearsal-env", file, created: false }, code: 0 };
  mkdirSync(dirname(file), { recursive: true });
  const lines = [
    `INTERNAL_TOKEN=${token()}`,
    `FINGERPRINT_KEY=${token()}`,
    `PUBLIC_PORT=${port}`,
    `INTERNAL_PORT=${port + 1}`,
    `DATA_DIR=${join(work, "data")}`,
    `RUN_DIR=${join(work, "run")}`,
    `LIVE_LEDGER_PATH=${liveLedger}`,
    "BRIDGE_MODE=fake",
    "ZALO_MODE=fake",
    "LOG_LEVEL=warn",
  ];
  writeFileSync(file, `${lines.join("\n")}\n`);
  return { line: { step: "rehearsal-env", file, created: true }, code: 0 };
}
