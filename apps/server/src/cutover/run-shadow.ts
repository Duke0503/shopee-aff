/**
 * `pnpm --filter @cashback/server shadow:run --live-copy <path> --out <dir> [--shopee <file>]
 * [--shopee-mapping <report_mapping.json>] [--accesstrade <file> | --accesstrade-api --since
 * <YYYY-MM-DD> --until <YYYY-MM-DD>] [--window-from <YYYY-MM-DD>] [--window-to <YYYY-MM-DD>]`: the shadow run (Story 2.9,
 * docs/operations/shadow-run.md). LIVE_LEDGER_PATH comes from the environment's config file, so
 * the production file itself is refused; the AccessTrade API key too, only for
 * `--accesstrade-api`. Prints one JSON line: exit 0 on success, 1 when refused or failed, 2 on
 * a usage error.
 */
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { addVnDays, instantFromMs, parseVnDate, systemClock, toMs, vnDayStart, type Instant } from "@cashback/core";

import { accessTradeApiSource, accessTradeFileSource, shopeeFileSource } from "../modules/linking/index";
import { loadConfig } from "../platform/config/env.config";
import { createLogger } from "../platform/log/logger";
import { runShadow, SHADOW_JSON, SHADOW_MARKDOWN, type ShadowSourceInput } from "./shadow-run";

const USAGE =
  "usage: shadow:run --live-copy <path> --out <dir> [--shopee <file> [--shopee-mapping <file>]] [--accesstrade <file> | --accesstrade-api --since <YYYY-MM-DD> --until <YYYY-MM-DD>] [--window-from <YYYY-MM-DD>] [--window-to <YYYY-MM-DD>]";

const OPTIONS = {
  "live-copy": { type: "string" },
  out: { type: "string" },
  shopee: { type: "string" },
  "shopee-mapping": { type: "string" },
  accesstrade: { type: "string" },
  "accesstrade-api": { type: "boolean" },
  since: { type: "string" },
  until: { type: "string" },
  "window-from": { type: "string" },
  "window-to": { type: "string" },
} as const;

/** The last millisecond before `next`: a Vietnam date's end, given the next day's start. */
const lastInstantBefore = (next: Instant): Instant => instantFromMs(toMs(next) - 1);
const dayEnd = (date: string): Instant => lastInstantBefore(vnDayStart(addVnDays(parseVnDate(date), 1)));

type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; strict: true }>>["values"];

class UsageError extends Error {}

function sources(values: Values, apiKey: () => string | null): ShadowSourceInput[] {
  const out: ShadowSourceInput[] = [];
  if (values.shopee) {
    const path = resolve(values.shopee);
    out.push({ source: shopeeFileSource({ path, mappingPath: values["shopee-mapping"] ? resolve(values["shopee-mapping"]) : undefined }) });
  }
  if (values.accesstrade && values["accesstrade-api"]) throw new UsageError("give --accesstrade or --accesstrade-api, not both");
  if (values.accesstrade) out.push({ source: accessTradeFileSource(resolve(values.accesstrade)) });
  if (values["accesstrade-api"]) {
    const key = apiKey();
    if (!values.since || !values.until) throw new UsageError("--accesstrade-api needs --since and --until");
    if (key === null) throw new UsageError("ACCESSTRADE_API_KEY is not set in the config file");
    const since = vnDayStart(parseVnDate(values.since));
    const until = vnDayStart(addVnDays(parseVnDate(values.until), 1));
    // The API was read for exactly this window: it is AccessTrade's report window.
    out.push({ source: accessTradeApiSource({ apiKey: key, since, until }), window: { from: since, to: lastInstantBefore(until) } });
  }
  if (out.length === 0) throw new UsageError("give at least one report: --shopee or --accesstrade");
  return out;
}

async function run(args: string[]): Promise<{ line: Record<string, unknown>; code: number }> {
  let values: Values;
  try {
    values = parseArgs({ args, options: OPTIONS, strict: true, allowPositionals: false }).values;
    if (!values["live-copy"] || !values.out) throw new UsageError("--live-copy and --out are required");
  } catch (error) {
    return { line: { ok: false, reason: "usage", error: `${error instanceof Error ? error.message : String(error)}; ${USAGE}` }, code: 2 };
  }
  try {
    const config = loadConfig();
    const out = resolve(values.out);
    const report = await runShadow({
      sourcePath: resolve(values["live-copy"]),
      liveLedgerPath: config.liveLedgerPath,
      sources: sources(values, () => config.accesstradeApiKey),
      outDir: out,
      clock: systemClock,
      logger: createLogger({ level: config.logLevel, destination: process.stderr }),
      windowFrom: values["window-from"] ? vnDayStart(parseVnDate(values["window-from"])) : undefined,
      windowTo: values["window-to"] ? dayEnd(values["window-to"]) : undefined,
    });
    return { line: { ok: true, json: resolve(out, SHADOW_JSON), markdown: resolve(out, SHADOW_MARKDOWN), paidParity: report.paidParity.result, changed: report.summary.changed, overpaid: report.summary.overpaid.length }, code: 0 };
  } catch (error) {
    if (error instanceof UsageError) return { line: { ok: false, reason: "usage", error: `${error.message}; ${USAGE}` }, code: 2 };
    const code = (error as { code?: unknown }).code;
    return { line: { ok: false, reason: typeof code === "string" ? code : "failed", error: error instanceof Error ? error.message : String(error) }, code: 1 };
  }
}

const { line, code } = await run(process.argv.slice(2));
process.stdout.write(`${JSON.stringify(line)}\n`);
process.exitCode = code;
