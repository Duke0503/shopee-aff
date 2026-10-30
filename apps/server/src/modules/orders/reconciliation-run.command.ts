/**
 * One reconciliation run of one network over one purchase-time window (AD-8, AD-13, AD-27, D43;
 * Stories 3.7 and 3.8): read the whole report first, with no ledger transaction open, then apply
 * each row in its own transaction, then write one insert-only `reconciliation_runs` row, a failed
 * run's included.
 *
 * - A read that fails applies nothing: a partial read never reaches the ledger. A page cap raises
 *   the owner alert `reconciliation_page_cap` every time (R6); any other read failure raises
 *   `reconciliation_failed` only when the previous run of the same kind and network failed too,
 *   so one passing network error is a log line and two in a row reach the owner.
 * - A saved file whose content (checksum and modification time) was first read more than 24 hours
 *   ago is stale: the run is `SOURCE_STALE`, applies nothing, so no order's last-seen time moves
 *   on old data, and raises `reconciliation_source_stale` (once per cooldown).
 * - A row whose apply throws is rolled back alone and counted; the other rows are applied and the
 *   run is marked failed (`row_apply_failed`), so it counts towards the alert.
 * - The scheduler's stop signal ends the run at its next step: the read is aborted, no further row
 *   is applied and no run row is written, so nothing touches the ledger after a stop.
 * - The duration comes from a monotonic clock; a wall clock that steps back during the run holds
 *   `finished_at` at `started_at` and is noted (`clock_stepped`).
 * - Overlapping windows are safe: a row applied before is a fingerprint skip, and a PAID order
 *   never changes (D4).
 */
import { toMs, type Clock, type Instant } from "@cashback/core";
import { and, asc, desc, eq, isNull } from "drizzle-orm";

import type { Ledger, LedgerDb } from "../../platform/db/ledger";
import type { Logger } from "../../platform/log/logger";
import type { AlertPort } from "../../platform/ports/alert.port";
import { ReportSourceError, type ReportWindow, type SourcedReport, type SourcedRow, type WindowedReportSource } from "../linking/index";
import type { ApplyReport } from "./report-apply.command";
import { RECONCILIATION_RUN_KINDS, reconciliationRuns, RUN_OUTCOMES } from "./schema";

export type RunKind = (typeof RECONCILIATION_RUN_KINDS)[number];
export type RunOutcome = (typeof RUN_OUTCOMES)[number];

/** A file whose same content was first read longer ago than this is stale. */
export const SOURCE_STALE_AFTER_MS = 24 * 60 * 60_000;

export interface RunCounts {
  rowsRead: number;
  applied: number;
  skipped: number;
  deferred: number;
  unrecorded: number;
  frozen: number;
  casesOpened: number;
  failedRows: number;
}

export interface RunRecord extends RunCounts {
  readonly runId: number;
  readonly kind: RunKind;
  readonly network: string;
  readonly outcome: RunOutcome;
  readonly errorCode: string | null;
}

export interface RunDeps {
  readonly ledger: Ledger;
  readonly clock: Clock;
  /** Milliseconds from a clock that never steps back (`performance.now` by default). */
  readonly monotonic?: () => number;
  /** The scheduler's stop signal (AD-13). */
  readonly signal?: AbortSignal;
  /** Outside any transaction: each alert is its own (`ledgerAlerts`). */
  readonly alerts: AlertPort;
  readonly logger: Pick<Logger, "info" | "warn" | "error">;
  /** Applies one row in its own `BEGIN IMMEDIATE` transaction (the composition binds the ports). */
  applyRow(row: SourcedRow): ApplyReport;
}

export class ReconciliationRunError extends Error {
  readonly code = "transaction_open";
  constructor() {
    super("a reconciliation read must not run inside a ledger transaction (code.md §5)");
    this.name = "ReconciliationRunError";
  }
}

/** Read through a call, so each check sees the signal as it is now. */
const aborted = (deps: RunDeps): boolean => deps.signal?.aborted === true;

const emptyCounts = (): RunCounts => ({ rowsRead: 0, applied: 0, skipped: 0, deferred: 0, unrecorded: 0, frozen: 0, casesOpened: 0, failedRows: 0 });

function tally(counts: RunCounts, report: ApplyReport): void {
  if (report.outcome === "skipped") counts.skipped++;
  else if (report.outcome === "deferred") counts.deferred++;
  else if (report.outcome === "unrecorded") counts.unrecorded++;
  else counts.applied++;
  if (report.steps.some(([, to]) => to === "FROZEN")) counts.frozen++;
  counts.casesOpened += report.reviewCases.length;
}

/** Applies the rows; null when the stop signal came first. */
function applyRows(rows: readonly SourcedRow[], deps: RunDeps, network: string): RunCounts | null {
  const counts = { ...emptyCounts(), rowsRead: rows.length };
  for (const row of rows) {
    if (aborted(deps)) return null;
    try {
      tally(counts, deps.applyRow(row));
    } catch (error) {
      counts.failedRows++;
      deps.logger.error({ network, orderId: row.orderId, fingerprint: row.fingerprint, err: error }, "orders.reconciliation.row_failed");
    }
  }
  return counts;
}

interface Started {
  readonly kind: RunKind;
  readonly network: WindowedReportSource["network"];
  readonly window: ReportWindow;
  readonly startedAt: Instant;
  readonly startedMono: number;
}

interface Ended extends Started {
  readonly report: SourcedReport | null;
  readonly counts: RunCounts;
  readonly outcome: RunOutcome;
  readonly errorCode: string | null;
}

function previousFailed(db: LedgerDb, kind: RunKind, network: Ended["network"]): boolean {
  const last = db
    .select({ outcome: reconciliationRuns.outcome })
    .from(reconciliationRuns)
    .where(and(eq(reconciliationRuns.kind, kind), eq(reconciliationRuns.network, network)))
    .orderBy(desc(reconciliationRuns.runId))
    .limit(1)
    .get();
  return last?.outcome === "FAILED";
}

/** When this exact file content (checksum and modification time) was first read by a run of the network. */
function firstReadAt(db: LedgerDb, network: Ended["network"], report: SourcedReport): Instant | null {
  if (report.sha256 === null) return null;
  const modified = report.modifiedAt ?? null;
  const first = db
    .select({ startedAt: reconciliationRuns.startedAt })
    .from(reconciliationRuns)
    .where(
      and(eq(reconciliationRuns.network, network), eq(reconciliationRuns.sourceSha256, report.sha256), modified === null ? isNull(reconciliationRuns.sourceModifiedAt) : eq(reconciliationRuns.sourceModifiedAt, modified)),
    )
    .orderBy(asc(reconciliationRuns.runId))
    .limit(1)
    .get();
  return (first?.startedAt ?? null) as Instant | null;
}

const monotonicOf = (deps: RunDeps): number => (deps.monotonic ?? (() => performance.now()))();

function alertFor(deps: RunDeps, e: Ended, failedBefore: boolean): void {
  if (e.errorCode === "report_page_cap") deps.alerts.alert("reconciliation_page_cap", "high");
  else if (e.outcome === "SOURCE_STALE") deps.alerts.alert("reconciliation_source_stale", "high");
  else if (e.outcome === "FAILED" && failedBefore) deps.alerts.alert("reconciliation_failed", "high");
}

function record(deps: RunDeps, e: Ended): RunRecord {
  const wall = deps.clock.now();
  const clockStepped = toMs(wall) < toMs(e.startedAt);
  const finishedAt = clockStepped ? e.startedAt : wall;
  const durationMs = Math.max(0, Math.trunc(monotonicOf(deps) - e.startedMono));
  const { runId, failedBefore } = deps.ledger.tx((db) => {
    const failedBefore = previousFailed(db, e.kind, e.network);
    const values = {
      kind: e.kind,
      network: e.network,
      source: e.report?.source ?? null,
      sourceSha256: e.report?.sha256 ?? null,
      sourceModifiedAt: e.report?.modifiedAt ?? null,
      windowFrom: e.window.since,
      windowTo: e.window.until,
      startedAt: e.startedAt,
      finishedAt,
      durationMs,
      clockStepped,
      outcome: e.outcome,
      errorCode: e.errorCode,
      ...e.counts,
    };
    const row = db.insert(reconciliationRuns).values(values).returning({ runId: reconciliationRuns.runId }).get();
    return { runId: row.runId, failedBefore };
  });
  const line = { runId, kind: e.kind, network: e.network, windowFrom: e.window.since, windowTo: e.window.until, outcome: e.outcome, errorCode: e.errorCode, durationMs, ...e.counts };
  if (clockStepped) deps.logger.warn({ runId, startedAt: e.startedAt, wallClock: wall }, "orders.reconciliation.clock_stepped");
  if (e.outcome === "SUCCEEDED") deps.logger.info(line, "orders.reconciliation.finished");
  else deps.logger.error(line, "orders.reconciliation.failed");
  alertFor(deps, e, failedBefore);
  return { runId, kind: e.kind, network: e.network, outcome: e.outcome, errorCode: e.errorCode, ...e.counts };
}

async function readAll(source: WindowedReportSource, window: ReportWindow, deps: RunDeps): Promise<SourcedReport> {
  if (deps.ledger.sqlite.inTransaction) throw new ReconciliationRunError();
  const report = await source.read(window, deps.signal);
  if (report.network !== source.network) throw new ReportSourceError("report_fetch_failed", `a ${source.network} source returned a ${report.network} report`);
  return report;
}

function isStale(deps: RunDeps, s: Started, report: SourcedReport): boolean {
  const first = firstReadAt(deps.ledger.db, s.network, report);
  return first !== null && toMs(s.startedAt) - toMs(first) > SOURCE_STALE_AFTER_MS;
}

/**
 * Runs one network over one window and records the run; never throws for a failed read. Returns
 * null, having written nothing, when the stop signal came before the run could be recorded.
 */
export async function runReconciliation(kind: RunKind, source: WindowedReportSource, window: ReportWindow, deps: RunDeps): Promise<RunRecord | null> {
  if (aborted(deps)) return null;
  const s: Started = { kind, network: source.network, window, startedAt: deps.clock.now(), startedMono: monotonicOf(deps) };
  let report: SourcedReport;
  try {
    report = await readAll(source, window, deps);
  } catch (error) {
    if (error instanceof ReconciliationRunError) throw error;
    if (aborted(deps)) return null;
    const errorCode = error instanceof ReportSourceError ? error.code : "report_fetch_failed";
    deps.logger.error({ network: source.network, err: error }, "orders.reconciliation.read_failed");
    return record(deps, { ...s, report: null, counts: emptyCounts(), outcome: "FAILED", errorCode });
  }
  if (aborted(deps)) return null;
  if (isStale(deps, s, report)) return record(deps, { ...s, report, counts: { ...emptyCounts(), rowsRead: report.rows.length }, outcome: "SOURCE_STALE", errorCode: "source_stale" });
  const counts = applyRows(report.rows, deps, source.network);
  if (counts === null) return null;
  return record(deps, { ...s, report, counts, outcome: counts.failedRows > 0 ? "FAILED" : "SUCCEEDED", errorCode: counts.failedRows > 0 ? "row_apply_failed" : null });
}

/** When the network's last run of `kind` succeeded, or null when none did. */
export function lastSucceededRun(db: LedgerDb, network: WindowedReportSource["network"], kind: RunKind): Instant | null {
  const last = db
    .select({ finishedAt: reconciliationRuns.finishedAt })
    .from(reconciliationRuns)
    .where(and(eq(reconciliationRuns.network, network), eq(reconciliationRuns.kind, kind), eq(reconciliationRuns.outcome, "SUCCEEDED")))
    .orderBy(desc(reconciliationRuns.runId))
    .limit(1)
    .get();
  return (last?.finishedAt ?? null) as Instant | null;
}
