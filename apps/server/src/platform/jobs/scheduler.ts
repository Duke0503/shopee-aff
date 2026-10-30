/**
 * The one job scheduler (AD-13, D52, Story 3.1). Jobs run inside the server; there is no
 * `job_leases` or `job_runs` table. Each job has an in-memory running flag and schedules its
 * next run only once the previous run has ended, a fixed delay later (or at the next Vietnam
 * time of day for daily jobs), so one job never overlaps itself whatever a run costs. A second
 * server on the same data is refused by the lock file (platform/lock), not here.
 *
 * Outcomes are log lines (AD-27): `<context>.job.finished` or `<context>.job.failed`, and
 * `<context>.job.skipped` when a run is asked for while one is going. A failed run is
 * rescheduled like a finished one. The clock and the timer are injected so tests drive time.
 * On shutdown no new run starts; `stop` waits for the current runs or gives up at its timeout.
 */
import { nextVnTimeOfDay, toMs, type Clock, type VnTimeOfDay } from "@cashback/core";

import type { Logger } from "../log/logger";

export type JobSchedule = { readonly kind: "every"; readonly delayMs: number } | { readonly kind: "daily_vn"; readonly at: VnTimeOfDay };

export interface Job {
  /** Unique per scheduler, e.g. `reconcile`. */
  readonly name: string;
  /** The log context, `<context>.job.failed` (a module name or `platform`). */
  readonly context: string;
  readonly schedule: JobSchedule;
  /** One run; may be synchronous. Its own transactions are its business. */
  readonly run: () => void | Promise<void>;
}

export interface JobTimer {
  schedule(fn: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export const systemTimer: JobTimer = {
  schedule: (fn, delayMs) => setTimeout(fn, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface SchedulerOptions {
  clock: Clock;
  timer: JobTimer;
  logger: Logger;
}

export type TriggerResult = "started" | "already_running" | "stopping" | "unknown_job";

export interface StopResult {
  /** True when every current run ended before the timeout. */
  finished: boolean;
  /** Jobs still running when `stop` gave up. */
  stillRunning: string[];
}

export interface Scheduler {
  /** Schedules the first run of every job; calling it twice does nothing. */
  start(): void;
  /** Runs a job now unless it is running or the scheduler is stopping. */
  trigger(name: string): TriggerResult;
  isRunning(name: string): boolean;
  stop(timeoutMs: number): Promise<StopResult>;
}

interface JobState {
  readonly job: Job;
  running: Promise<void> | null;
  /** The one timer this job owns, or null. */
  pending: unknown;
  /** Bumped whenever the pending timer is replaced or cancelled; a callback from an older timer does nothing. */
  generation: number;
}

export function delayUntilNextRun(schedule: JobSchedule, clock: Clock): number {
  if (schedule.kind === "every") return schedule.delayMs;
  const now = clock.now();
  return toMs(nextVnTimeOfDay(now, schedule.at)) - toMs(now);
}

function assertJobs(jobs: readonly Job[]): void {
  const names = new Set<string>();
  for (const job of jobs) {
    if (names.has(job.name)) throw new Error(`two jobs named ${job.name}`);
    names.add(job.name);
    if (job.schedule.kind === "every" && !(Number.isInteger(job.schedule.delayMs) && job.schedule.delayMs > 0)) {
      throw new RangeError(`job ${job.name}: the delay must be a positive whole number of milliseconds`);
    }
  }
}

interface Context extends SchedulerOptions {
  readonly states: Map<string, JobState>;
  started: boolean;
  stopping: boolean;
}

function cancelPending(ctx: Context, state: JobState): void {
  if (state.pending !== null) ctx.timer.cancel(state.pending);
  state.pending = null;
  state.generation++;
}

/** Replaces the job's timer; nothing is scheduled before `start`, while stopping, or while it runs. */
function scheduleNext(ctx: Context, state: JobState): void {
  cancelPending(ctx, state);
  if (!ctx.started || ctx.stopping || state.running) return;
  const generation = state.generation;
  state.pending = ctx.timer.schedule(() => {
    if (state.generation !== generation) return;
    state.pending = null;
    runOnce(ctx, state);
  }, delayUntilNextRun(state.job.schedule, ctx.clock));
}

function runOnce(ctx: Context, state: JobState): TriggerResult {
  const { job } = state;
  if (ctx.stopping) return "stopping";
  if (state.running) {
    ctx.logger.warn({ job: job.name }, `${job.context}.job.skipped`);
    return "already_running";
  }
  cancelPending(ctx, state);
  const startedAt = toMs(ctx.clock.now());
  const elapsed = () => toMs(ctx.clock.now()) - startedAt;
  state.running = Promise.resolve()
    .then(() => job.run())
    .then(
      () => ctx.logger.info({ job: job.name, durationMs: elapsed() }, `${job.context}.job.finished`),
      (error: unknown) => ctx.logger.error({ job: job.name, durationMs: elapsed(), err: error }, `${job.context}.job.failed`),
    )
    .finally(() => {
      state.running = null;
      scheduleNext(ctx, state);
    });
  return "started";
}

async function stopAll(ctx: Context, timeoutMs: number): Promise<StopResult> {
  ctx.stopping = true;
  for (const state of ctx.states.values()) cancelPending(ctx, state);
  const running = [...ctx.states.values()].filter((s) => s.running !== null);
  let timeoutHandle: unknown = null;
  const timedOut = new Promise<false>((resolve) => {
    timeoutHandle = ctx.timer.schedule(() => resolve(false), timeoutMs);
  });
  const finished = await Promise.race([Promise.all(running.map((s) => s.running)).then(() => true as const), timedOut]);
  ctx.timer.cancel(timeoutHandle);
  const stillRunning = running.filter((s) => s.running !== null).map((s) => s.job.name);
  ctx.logger.info({ finished, stillRunning }, "platform.jobs.stopped");
  return { finished, stillRunning };
}

export function createScheduler(jobs: readonly Job[], options: SchedulerOptions): Scheduler {
  assertJobs(jobs);
  const ctx: Context = { ...options, states: new Map(jobs.map((job) => [job.name, { job, running: null, pending: null, generation: 0 }])), started: false, stopping: false };
  return {
    start() {
      if (ctx.started || ctx.stopping) return;
      ctx.started = true;
      // A job already running (triggered before start) schedules itself when its run ends.
      for (const state of ctx.states.values()) scheduleNext(ctx, state);
    },
    trigger(name) {
      const state = ctx.states.get(name);
      return state ? runOnce(ctx, state) : "unknown_job";
    },
    isRunning: (name) => ctx.states.get(name)?.running != null,
    stop: (timeoutMs) => stopAll(ctx, timeoutMs),
  };
}
