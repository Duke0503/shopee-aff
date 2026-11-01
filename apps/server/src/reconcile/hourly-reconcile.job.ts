/**
 * The hourly reconciliation job (AD-8, AD-13, D43; Story 3.7): every 60 minutes after the last run
 * ended (platform/jobs/job-schedules.ts), each enabled network's source is read for the last 7
 * Vietnam days by purchase time, today included, and applied row by row. Networks run one after
 * the other, so one failing source never stops the next. Each row is one `tx` with the apply
 * ports of apply-deps.ts; alerts are raised outside any transaction.
 */
import { addVnDays, vnDayStart, vnToday, type Clock } from "@cashback/core";

import type { ReportWindow, WindowedReportSource } from "../modules/linking/index";
import { ledgerAlerts } from "../modules/operations/index";
import { applyReportRow, runReconciliation, type RunDeps, type RunKind, type RunRecord } from "../modules/orders/index";
import type { Ledger } from "../platform/db/ledger";
import type { Logger } from "../platform/log/logger";
import { applyDepsFor } from "./apply-deps";

/** The hourly window: the last 7 Vietnam days, today included (D43). */
export const HOURLY_WINDOW_DAYS = 7;

export interface ReconcileContext {
  readonly ledger: Ledger;
  readonly clock: Clock;
  readonly logger: Logger;
  /** The enabled networks' sources; a network without one is not read. */
  readonly sources: readonly WindowedReportSource[];
  /** Production never credits a DEV sub_id (AD-25). */
  readonly production: boolean;
  /** Dev credits only DEV links (Story 8.1). */
  readonly devOnly?: boolean;
  /** The scheduler's stop signal for this run (AD-13); nothing touches the ledger after it. */
  readonly signal?: AbortSignal;
  /** A clock that never steps back, for run durations; `performance.now` by default. */
  readonly monotonic?: () => number;
}

export function hourlyWindow(clock: Clock): ReportWindow {
  return {
    since: vnDayStart(addVnDays(vnToday(clock), -(HOURLY_WINDOW_DAYS - 1))),
    until: clock.now(),
  };
}

/** The run's ports: each row is applied in its own `BEGIN IMMEDIATE` transaction (AD-8). */
export function runDepsFor(ctx: ReconcileContext): RunDeps {
  return {
    ledger: ctx.ledger,
    clock: ctx.clock,
    alerts: ledgerAlerts(ctx.ledger, ctx.clock, ctx.logger),
    logger: ctx.logger,
    ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
    ...(ctx.monotonic === undefined ? {} : { monotonic: ctx.monotonic }),
    applyRow: (row) => ctx.ledger.tx((db) => applyReportRow(db, row, applyDepsFor(db, ctx.clock, { production: ctx.production, devOnly: ctx.devOnly === true }))),
  };
}

/** One run; null when the stop signal ended it before anything was recorded. */
export async function reconcileWindow(ctx: ReconcileContext, kind: RunKind, source: WindowedReportSource, window: ReportWindow): Promise<RunRecord | null> {
  return runReconciliation(kind, source, window, runDepsFor(ctx));
}

/** One hourly run over every enabled network. */
export async function runHourlyReconcile(ctx: ReconcileContext): Promise<RunRecord[]> {
  const window = hourlyWindow(ctx.clock);
  const runs: RunRecord[] = [];
  for (const source of ctx.sources) {
    const run = await reconcileWindow(ctx, "HOURLY", source, window);
    if (run === null) break;
    runs.push(run);
  }
  return runs;
}
