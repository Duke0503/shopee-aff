/**
 * The restore commands of Story 8.6 (docs/operations/restore-runbook.md). The environment is
 * named on the command line, never taken from a default, so a drill on a dev machine cannot touch
 * production by accident; the env file's isolation check runs as at every start.
 *
 *   pnpm restore:ledger -- --env dev --archive <decrypted .tar> [--replace]
 *   pnpm restore:drill-record -- --env prod --at <ISO instant> --minutes <n> --result pass|fail [--archive <name>]
 *
 * `restore:ledger` runs restore-ledger.ts and prints one JSON line with the outcome and the
 * restored balance totals; exit 0 only when the restore passed every check. `restore:drill-record`
 * writes the drill record the Overview health line reads (restore-drill.ts) into the named
 * environment's data folder and prints the row to add to the runbook's drill log.
 */
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { parseInstant, systemClock, toMs, type Instant } from "@cashback/core";

import { balanceTotals } from "../modules/payouts/index";
import { DRILL_RESULTS, drillRecordPath, writeDrillRecord, type DrillResult } from "../platform/backup/restore-drill";
import { ConfigError, ENVIRONMENTS, loadConfigFor, type Environment } from "../platform/config/env.config";
import { restoreLedger } from "./restore-ledger";

type Outcome = { readonly event: string; readonly [key: string]: unknown };

const environmentOf = (raw: string | undefined): Environment | null => ((ENVIRONMENTS as readonly (string | undefined)[]).includes(raw) ? (raw as Environment) : null);

function instantOrNull(text: string | undefined): Instant | null {
  try {
    return text === undefined ? null : parseInstant(text);
  } catch {
    return null;
  }
}

async function ledgerCommand(args: string[]): Promise<{ outcome: Outcome; code: number }> {
  const { values } = parseArgs({ args, options: { env: { type: "string" }, archive: { type: "string" }, replace: { type: "boolean", default: false } } });
  const env = environmentOf(values.env);
  if (env === null || values.archive === undefined) return { outcome: { event: "platform.restore.refused", reason: "usage", usage: "--env dev|prod --archive <file.tar> [--replace]" }, code: 1 };
  const config = loadConfigFor(env);
  const started = toMs(systemClock.now());
  const result = await restoreLedger({ archive: values.archive, dataDir: config.dataDir, clock: systemClock, replace: values.replace, totals: balanceTotals });
  const seconds = Math.floor((toMs(systemClock.now()) - started) / 1000);
  if (!result.ok) return { outcome: { event: result.rolledBack ? "platform.restore.rolled_back" : "platform.restore.refused", env, reason: result.refusal, problems: result.problems, ...(result.rolledBack ? { rolledBack: result.rolledBack } : {}), seconds }, code: 1 };
  return { outcome: { event: "platform.restore.done", env, ledger: result.ledger, files: result.files, totals: result.totals, movedAside: result.movedAside, backupCreatedAt: result.backupCreatedAt, seconds }, code: 0 };
}

function drillCommand(args: string[]): { outcome: Outcome; code: number } {
  const { values } = parseArgs({ args, options: { env: { type: "string" }, at: { type: "string" }, minutes: { type: "string" }, result: { type: "string" }, archive: { type: "string" } } });
  const env = environmentOf(values.env);
  const minutes = Number(values.minutes);
  const result = (DRILL_RESULTS as readonly (string | undefined)[]).includes(values.result) ? (values.result as DrillResult) : null;
  const at = instantOrNull(values.at);
  if (env === null || at === null || result === null || !Number.isInteger(minutes) || minutes < 0) {
    return { outcome: { event: "platform.restore.drill_refused", reason: "usage", usage: "--env dev|prod --at <ISO instant> --minutes <n> --result pass|fail [--archive <name>]" }, code: 1 };
  }
  const config = loadConfigFor(env);
  const archive = values.archive === undefined ? null : basename(values.archive);
  writeDrillRecord(drillRecordPath(config.dataDir), { at, durationMinutes: minutes, result, archive });
  const logRow = `| ${at.slice(0, 10)} | ${minutes} min | ${result} | ${archive ?? "-"} | |`;
  return { outcome: { event: "platform.restore.drill_recorded", env, at, minutes, result, logRow }, code: 0 };
}

async function run(argv: string[]): Promise<{ outcome: Outcome; code: number }> {
  const [command, ...args] = argv;
  try {
    if (command === "ledger") return await ledgerCommand(args);
    if (command === "drill-record") return drillCommand(args);
    return { outcome: { event: "platform.restore.refused", reason: "usage", usage: "ledger | drill-record" }, code: 1 };
  } catch (error) {
    if (error instanceof ConfigError) return { outcome: { event: "platform.restore.refused", reason: "config", message: error.message }, code: 1 };
    throw error;
  }
}

const { outcome, code } = await run(process.argv.slice(2).filter((arg) => arg !== "--"));
process.stdout.write(`${JSON.stringify(outcome)}\n`);
process.exitCode = code;
