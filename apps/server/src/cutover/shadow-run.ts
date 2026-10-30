/**
 * The shadow run (D44, FR-33, Story 2.9): reads every report source first, with no database open
 * (a failed read, a page cap included, stops the run before anything is written, D43), then the
 * live copy read-only (shadow-ledger.ts), applies the new reconciliation in memory
 * (shadow-evaluate.ts) and writes `shadow-report.json` and `shadow-report.md` into the out
 * folder. The live copy's checksum is taken before and after; a change fails the run. The same
 * inputs give byte-identical files. A folder whose report was signed off is never written over;
 * the sign-off (name, time, the report checksums) is recorded by `signShadowReport`.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import type { Clock, Instant } from "@cashback/core";
import type { AffiliateNetwork } from "@cashback/money";

import type { ReportSource, SourcedReport, SourcedRow } from "../modules/linking/index";
import type { Logger } from "../platform/log/logger";
import { evaluateShadow, type ReportWindow } from "./shadow-evaluate";
import { readShadowLedger, type ShadowLedger } from "./shadow-ledger";
import { renderShadowMarkdown } from "./shadow-markdown";
import { buildShadowReport, type ReportInput, type ShadowReport } from "./shadow-report";

export const SHADOW_JSON = "shadow-report.json";
export const SHADOW_MARKDOWN = "shadow-report.md";
export const SHADOW_SIGN_OFF = "shadow-sign-off.json";

export interface ShadowSourceInput {
  source: ReportSource;
  /** The window the source was read for (the AccessTrade API's since and fetch end); wins over the run's window. */
  window?: { from: Instant; to: Instant };
}

export interface ShadowRunOptions {
  sourcePath: string;
  liveLedgerPath: string | null;
  sources: readonly ShadowSourceInput[];
  outDir: string;
  clock: Clock;
  logger: Logger;
  /** Overrides the report window's start; by default each network's earliest purchase in its report. */
  windowFrom?: Instant;
  /** Overrides the report window's last instant; by default each network's latest purchase in its report. */
  windowTo?: Instant;
  migrationsDir?: string;
  /** Staff marks per `<network>|<YYYY-MM>` to judge approvals under; none by default (D54). */
  periodMarks?: ReadonlyMap<string, boolean>;
}

export type ShadowRefusal = "live_ledger_path_missing" | "signed_off" | "duplicate_source" | "live_copy_changed" | "name_missing" | "report_missing";

export class ShadowRefusedError extends Error {
  constructor(
    readonly code: ShadowRefusal,
    message: string,
  ) {
    super(message);
    this.name = "ShadowRefusedError";
  }
}

export const sha256File = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");
const sha256Text = (text: string): string => createHash("sha256").update(text).digest("hex");

function refuse(options: ShadowRunOptions): void {
  if (options.liveLedgerPath === null || !isAbsolute(options.liveLedgerPath)) {
    throw new ShadowRefusedError("live_ledger_path_missing", "LIVE_LEDGER_PATH (absolute) must be set so the shadow run can refuse the live production file");
  }
  if (existsSync(join(options.outDir, SHADOW_SIGN_OFF))) throw new ShadowRefusedError("signed_off", `the report in ${options.outDir} is signed off; write a new run to another folder`);
  const networks = options.sources.map((s) => s.source.network);
  if (new Set(networks).size !== networks.length) throw new ShadowRefusedError("duplicate_source", "give at most one report source per network");
}

/** The window a source covers: the window it was read for, else the run's overrides, else its earliest and latest purchase. */
export function windowOf(rows: readonly SourcedRow[], read: ShadowSourceInput["window"], options: Pick<ShadowRunOptions, "windowFrom" | "windowTo">): ReportWindow {
  if (read !== undefined) return read;
  const times = rows.map((r) => r.purchasedAt).filter((t): t is Instant => t !== null);
  const first = times.length === 0 ? null : times.reduce((a, b) => (b < a ? b : a));
  const last = times.length === 0 ? null : times.reduce((a, b) => (b > a ? b : a));
  return { from: options.windowFrom ?? first, to: options.windowTo ?? last };
}

interface Read {
  report: SourcedReport;
  window: ReportWindow;
}

async function readSources(options: ShadowRunOptions): Promise<Read[]> {
  const out: Read[] = [];
  for (const s of options.sources) {
    const report = await s.source.read();
    options.logger.info({ network: report.network, rows: report.rows.length, skippedLines: report.skippedLines }, "cutover.shadow.source_read");
    out.push({ report, window: windowOf(report.rows, s.window, options) });
  }
  return out;
}

/** Approved unpaid live orders whose customer id is no customer (LIVE_ORPHAN_OWED_SQL). */
const orphanIds = (ledger: ShadowLedger): Set<string> => new Set(ledger.liveOrphanOwed.map((o) => o.order_id));

export async function runShadow(options: ShadowRunOptions): Promise<ShadowReport> {
  refuse(options);
  const read = await readSources(options);
  const before = sha256File(options.sourcePath);
  const ledger = readShadowLedger({ sourcePath: options.sourcePath, liveLedgerPath: options.liveLedgerPath, clock: options.clock, migrationsDir: options.migrationsDir });
  const rows = new Map<AffiliateNetwork, readonly SourcedRow[]>(read.map((r) => [r.report.network, r.report.rows]));
  const window = new Map<AffiliateNetwork, ReportWindow>(read.map((r) => [r.report.network, r.window]));
  const orders = evaluateShadow({ live: ledger.live, rows, window, liveOrphans: orphanIds(ledger), approvedAt: options.clock.now(), periodMarks: options.periodMarks });
  const reports: ReportInput[] = read
    .map((r) => ({ network: r.report.network, source: r.report.source, sha256: r.report.sha256, rows: r.report.rows.length, skippedLines: r.report.skippedLines, windowFrom: r.window.from, windowTo: r.window.to }))
    .sort((a, b) => (a.network < b.network ? -1 : 1));
  const report = buildShadowReport(ledger, orders, { liveCopy: { file: basename(options.sourcePath), sha256: before }, reports });
  if (sha256File(options.sourcePath) !== before) throw new ShadowRefusedError("live_copy_changed", "the live copy changed during the shadow run");
  mkdirSync(options.outDir, { recursive: true });
  writeFileSync(join(options.outDir, SHADOW_JSON), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(options.outDir, SHADOW_MARKDOWN), renderShadowMarkdown(report));
  options.logger.info({ orders: report.summary.orders, changed: report.summary.changed, paidParity: report.paidParity.result, overpaid: report.summary.overpaid.length }, "cutover.shadow.finished");
  return report;
}

export interface ShadowSignOff {
  name: string;
  signedAt: Instant;
  reportSha256: string;
  markdownSha256: string;
  paidParity: string;
  changedOrders: number;
}

/** Records the owner's sign-off of the report in `outDir`, once. */
export function signShadowReport(outDir: string, name: string, clock: Clock): ShadowSignOff {
  if (name.trim() === "") throw new ShadowRefusedError("name_missing", "the sign-off needs the owner's name");
  const json = join(outDir, SHADOW_JSON);
  const markdown = join(outDir, SHADOW_MARKDOWN);
  if (!existsSync(json) || !existsSync(markdown)) throw new ShadowRefusedError("report_missing", `no shadow report in ${outDir}`);
  const target = join(outDir, SHADOW_SIGN_OFF);
  if (existsSync(target)) throw new ShadowRefusedError("signed_off", `already signed off: ${target}`);
  const text = readFileSync(json, "utf8");
  const report = JSON.parse(text) as ShadowReport;
  const signOff: ShadowSignOff = {
    name: name.trim(),
    signedAt: clock.now(),
    reportSha256: sha256Text(text),
    markdownSha256: sha256File(markdown),
    paidParity: report.paidParity.result,
    changedOrders: report.summary.changed,
  };
  writeFileSync(target, `${JSON.stringify(signOff, null, 2)}\n`, { flag: "wx" });
  return signOff;
}
