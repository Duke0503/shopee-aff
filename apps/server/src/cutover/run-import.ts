/**
 * `pnpm cutover:import <live-copy> <new-ledger>`: the one-shot cutover import (AD-24). It reads
 * the fingerprint key and the live production path from the environment's config file, refuses
 * the production file itself, writes the new ledger and `<new-ledger>.import-report.json` (also
 * on failure, once the source was reached), and prints one JSON line: exit 0 on success, 1 when
 * refused or failed, 2 on a usage error.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { systemClock } from "@cashback/core";

import { loadConfig } from "../platform/config/env.config";
import { createLogger } from "../platform/log/logger";
import { reportPathFor, runCutoverImport } from "./import-run";

function run(args: readonly string[]): { line: Record<string, unknown>; code: number } {
  const [sourceArg, targetArg] = args;
  if (!sourceArg || !targetArg || args.length > 2) return { line: { ok: false, reason: "usage", error: "usage: pnpm cutover:import <live-copy> <new-ledger>" }, code: 2 };
  const target = resolve(targetArg);
  const reportPath = reportPathFor(target);
  try {
    const config = loadConfig();
    const report = runCutoverImport({
      sourcePath: resolve(sourceArg),
      targetPath: target,
      fingerprintKey: config.fingerprintKey,
      liveLedgerPath: config.liveLedgerPath,
      clock: systemClock,
      logger: createLogger({ level: config.logLevel, destination: process.stderr }),
    });
    return { line: { ok: true, report: reportPath, timeProblems: report.timeProblems.length, notes: report.notes.length }, code: 0 };
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    const line = { ok: false, reason: typeof code === "string" ? code : "failed", error: error instanceof Error ? error.message : String(error) };
    return { line: existsSync(reportPath) ? { ...line, report: reportPath } : line, code: 1 };
  }
}

const { line, code } = run(process.argv.slice(2));
process.stdout.write(`${JSON.stringify(line)}\n`);
process.exitCode = code;
