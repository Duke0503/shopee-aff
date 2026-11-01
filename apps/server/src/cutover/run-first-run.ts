/**
 * `pnpm cutover:first-run <new-ledger> [--shopee <file> [--shopee-mapping <file>]] [--accesstrade <file>]`:
 * the quiet first run on the ledger the cutover import wrote (Story 6.10, first-run.ts). Report
 * sources are saved files only: this command never calls a network, Zalo or Telegram. It refuses
 * the live production file (LIVE_LEDGER_PATH), a ledger with pending migrations and a ledger whose
 * `messaging.silent` is off, and prints one JSON line of counts: the reconciliation runs, the
 * links the delivery check sent or closed, and the would-be sends per event and message key. Exit
 * 0 on success, 1 when refused or failed, 2 on a usage error.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { systemClock } from "@cashback/core";

import { accessTradeFileWindowSource, shopeeFileWindowSource, type WindowedReportSource } from "../modules/linking/index";
import { loadConfig } from "../platform/config/env.config";
import { openLedger } from "../platform/db/ledger";
import { MIGRATIONS_DIR, pendingMigrations, readMigrations } from "../platform/db/migrations";
import { createLogger } from "../platform/log/logger";
import { runQuietFirstRun } from "./first-run";
import { samePath } from "./live-source";

const USAGE = "usage: cutover:first-run <new-ledger> [--shopee <file> [--shopee-mapping <file>]] [--accesstrade <file>]";
const OPTIONS = { shopee: { type: "string" }, "shopee-mapping": { type: "string" }, accesstrade: { type: "string" } } as const;

function sourcesOf(values: { shopee?: string; "shopee-mapping"?: string; accesstrade?: string }): WindowedReportSource[] {
  const sources: WindowedReportSource[] = [];
  if (values.shopee) sources.push(shopeeFileWindowSource({ path: resolve(values.shopee), ...(values["shopee-mapping"] ? { mappingPath: resolve(values["shopee-mapping"]) } : {}) }));
  if (values.accesstrade) sources.push(accessTradeFileWindowSource(resolve(values.accesstrade)));
  return sources;
}

async function run(args: string[]): Promise<{ line: Record<string, unknown>; code: number }> {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; strict: true; allowPositionals: true }>>;
  try {
    parsed = parseArgs({ args, options: OPTIONS, strict: true, allowPositionals: true });
    if (parsed.positionals.length !== 1) throw new Error("give the new ledger");
  } catch (error) {
    return { line: { ok: false, reason: "usage", error: `${error instanceof Error ? error.message : String(error)}; ${USAGE}` }, code: 2 };
  }
  const path = resolve(parsed.positionals[0] ?? "");
  try {
    const config = loadConfig();
    if (config.liveLedgerPath !== null && samePath(path, config.liveLedgerPath)) return { line: { ok: false, reason: "live_production_file" }, code: 1 };
    if (!existsSync(path)) return { line: { ok: false, reason: "ledger_missing" }, code: 1 };
    const ledger = openLedger(path);
    try {
      if (pendingMigrations(ledger, readMigrations(MIGRATIONS_DIR)).length > 0) return { line: { ok: false, reason: "ledger_not_migrated" }, code: 1 };
      const logger = createLogger({ level: config.logLevel, destination: process.stderr });
      const report = await runQuietFirstRun({ ledger, clock: systemClock, logger, sources: sourcesOf(parsed.values), production: config.env === "prod" });
      return { line: { ok: true, ...report }, code: 0 };
    } finally {
      ledger.close();
    }
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return { line: { ok: false, reason: typeof code === "string" ? code : "failed", error: error instanceof Error ? error.message : String(error) }, code: 1 };
  }
}

const { line, code } = await run(process.argv.slice(2));
process.stdout.write(`${JSON.stringify(line)}\n`);
process.exitCode = code;
