/**
 * The nightly sweep (AD-8, AD-13, D43, R5, R6; Story 3.8). Shopee approves 30 to 70 days after
 * purchase, beyond the hourly 7-day window, so at 02:00 Vietnam time the sweep reads, one day per
 * read, every older purchase day that still holds an unresolved order (open-order-days.query.ts),
 * and nothing else. Each day slice is one reconciliation run (`NIGHTLY`), with the source's page
 * cap per slice: a slice at its cap, or a failed or stale read, fails that run loudly and ends the
 * network's sweep for the night, so nothing is frozen or changed from a partial read.
 *
 * Pacing: a pause between slices (the bridge yields to link jobs between pages, AD-14), and a
 * stop time before the 03:00 backup, so the sweep never overlaps it. Days left at the stop time
 * are read first the next night (least recently seen first). Days older than the report keeps
 * (90 days) are not read; their orders reach staff through the R5 aging cases.
 *
 * R5 aging trusts a network only when its source is configured, none of its reads failed tonight,
 * and its hourly run succeeded in the last 24 hours: a network that was not read cannot say an
 * order is missing from its report. The scheduler's stop signal cancels the pause, starts no new
 * slice and skips the aging pass, so the ledger is not touched after a stop.
 */
import { addVnDays, nextVnTimeOfDay, toMs, vnDayStart, vnToday, type VnDate, type VnTimeOfDay } from "@cashback/core";
import type { AffiliateNetwork } from "@cashback/money";

import type { WindowedReportSource } from "../modules/linking/index";
import { commandAudit } from "../modules/operations/index";
import { flagUnseenOrders, lastSucceededRun, openOrderDays, type RunRecord } from "../modules/orders/index";
import type { JobTimer } from "../platform/jobs/scheduler";
import { RECONCILE_ACTOR } from "./apply-deps";
import { HOURLY_WINDOW_DAYS, reconcileWindow, type ReconcileContext } from "./hourly-reconcile.job";

export interface SweepPacing {
  /** The pause between two day slices. */
  readonly pauseMs: number;
  /** No slice starts at or after this Vietnam time; it is before the 03:00 backup (AD-13). */
  readonly stopAt: VnTimeOfDay;
  /** The oldest purchase day read, in days back from today; the reports keep 90 days (R6). */
  readonly maxAgeDays: number;
}

export const SWEEP_PACING: SweepPacing = { pauseMs: 30_000, stopAt: { hour: 2, minute: 50 }, maxAgeDays: 90 };

/** How recent a network's last successful hourly run must be for R5 aging to trust it. */
export const HOURLY_TRUSTED_FOR_MS = 24 * 60 * 60_000;

/** Resolves after `ms`, or at once when `signal` aborts. */
export type Wait = (ms: number, signal?: AbortSignal) => Promise<void>;

/** A cancellable pause on the scheduler's timer. */
export function timerWait(timer: JobTimer): Wait {
  return (ms, signal) =>
    new Promise<void>((resolve) => {
      if (signal?.aborted === true) return resolve();
      const handle = timer.schedule(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        timer.cancel(handle);
        resolve();
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
}

export interface SweepContext extends ReconcileContext {
  readonly pacing: SweepPacing;
  readonly wait: Wait;
}

export interface SweepResult {
  readonly slices: readonly RunRecord[];
  /** Days left for the next night because the stop time came. */
  readonly notReached: number;
  /** Days not read because an earlier slice of the same network failed its read. */
  readonly afterFailure: number;
  /** Days older than the report keeps, not read. */
  readonly beyondWindow: number;
  readonly unplaced: number;
  /** The networks R5 aging trusted tonight. */
  readonly trusted: readonly AffiliateNetwork[];
  /** `not_seen_in_report` cases opened by the aging pass. */
  readonly flagged: number;
  /** The scheduler stopped the sweep. */
  readonly stopped: boolean;
}

interface Plan {
  readonly source: WindowedReportSource;
  readonly days: readonly VnDate[];
}

function plan(ctx: SweepContext, counts: { beyondWindow: number; unplaced: number }): Plan[] {
  const today = vnToday(ctx.clock);
  const oldest = addVnDays(today, -(ctx.pacing.maxAgeDays - 1));
  const newest = addVnDays(today, -HOURLY_WINDOW_DAYS);
  return ctx.sources.map((source) => {
    const open = openOrderDays(ctx.ledger.db, source.network);
    counts.unplaced += open.unplaced;
    counts.beyondWindow += open.days.filter((d) => d.day < oldest).length;
    return { source, days: open.days.map((d) => d.day).filter((day) => day >= oldest && day <= newest) };
  });
}

interface Progress {
  readonly slices: RunRecord[];
  notReached: number;
  afterFailure: number;
  readonly failedNetworks: Set<AffiliateNetwork>;
}

const stopped = (ctx: SweepContext): boolean => ctx.signal?.aborted === true;
const readFailed = (run: RunRecord): boolean => run.outcome !== "SUCCEEDED" && run.errorCode !== "row_apply_failed";

async function sweepNetwork(ctx: SweepContext, p: Plan, stopAtMs: number, progress: Progress): Promise<void> {
  const late = () => toMs(ctx.clock.now()) >= stopAtMs;
  for (const [i, day] of p.days.entries()) {
    if (!late() && progress.slices.length > 0) await ctx.wait(ctx.pacing.pauseMs, ctx.signal);
    if (stopped(ctx)) return;
    if (late()) {
      progress.notReached += p.days.length - i;
      return;
    }
    const run = await reconcileWindow(ctx, "NIGHTLY", p.source, { since: vnDayStart(day), until: vnDayStart(addVnDays(day, 1)) });
    if (run === null) return;
    progress.slices.push(run);
    // A read that failed ends this network's sweep: a slice at its cap, a stale file or a source that is down.
    if (readFailed(run)) {
      progress.failedNetworks.add(p.source.network);
      progress.afterFailure += p.days.length - i - 1;
      return;
    }
  }
}

/** The configured networks whose reads all succeeded tonight and whose hourly run succeeded in the last 24 hours. */
function trustedNetworks(ctx: SweepContext, failed: ReadonlySet<AffiliateNetwork>): AffiliateNetwork[] {
  const now = toMs(ctx.clock.now());
  return ctx.sources
    .map((s) => s.network)
    .filter((network) => {
      if (failed.has(network)) return false;
      const last = lastSucceededRun(ctx.ledger.db, network, "HOURLY");
      return last !== null && now - toMs(last) <= HOURLY_TRUSTED_FOR_MS;
    });
}

export async function runNightlySweep(ctx: SweepContext): Promise<SweepResult> {
  const stopAtMs = toMs(nextVnTimeOfDay(ctx.clock.now(), ctx.pacing.stopAt));
  const counts = { beyondWindow: 0, unplaced: 0 };
  const progress: Progress = { slices: [], notReached: 0, afterFailure: 0, failedNetworks: new Set() };
  for (const p of plan(ctx, counts)) {
    if (stopped(ctx)) break;
    await sweepNetwork(ctx, p, stopAtMs, progress);
  }
  const { slices, notReached, afterFailure } = progress;
  if (stopped(ctx)) {
    ctx.logger.warn({ slices: slices.length }, "orders.sweep.stopped");
    return { slices, notReached, afterFailure, ...counts, trusted: [], flagged: 0, stopped: true };
  }
  const trusted = trustedNetworks(ctx, progress.failedNetworks);
  const flagged = ctx.ledger.tx((db) => flagUnseenOrders(db, { by: commandAudit(db, ctx.clock, RECONCILE_ACTOR), at: ctx.clock.now() }, trusted));
  const failed = slices.filter((s) => s.outcome !== "SUCCEEDED").length;
  ctx.logger.info({ slices: slices.length, failed, flagged, trusted, notReached, afterFailure, ...counts }, "orders.sweep.finished");
  if (notReached > 0) ctx.logger.warn({ notReached }, "orders.sweep.stopped_at_deadline");
  return { slices, notReached, afterFailure, ...counts, trusted, flagged, stopped: false };
}
