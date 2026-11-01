/**
 * Story 3.1: the in-process job scheduler (AD-13, D52). Time is a fake clock and timer moved
 * by the test, so no test waits on real time.
 */
import { describe, expect, it } from "vitest";

import { JOB_SCHEDULES } from "../src/platform/jobs/job-schedules";
import { createScheduler, delayUntilNextRun, type Job } from "../src/platform/jobs/scheduler";
import { createLogger } from "../src/platform/log/logger";
import { fakeTime, flush } from "./helpers/fake-time";

const START = "2026-10-30T07:00:00.000Z";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({ destination: { write: (line: string) => void lines.push(JSON.parse(line) as Record<string, unknown>) } });
  return { logger, events: () => lines.map((l) => l["msg"]), lines };
}

/** A run that stays open until the test releases it. */
function gate() {
  let release: () => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  return { promise, release: () => release(), fail: (error: Error) => fail(error) };
}

describe("Story 3.1 acceptance criteria", () => {
  it("AC1: a run longer than its delay never overlaps itself; the next run starts a delay after it ends", async () => {
    const time = fakeTime(START);
    const log = capture();
    const starts: string[] = [];
    let current = gate();
    const job: Job = {
      name: "links",
      context: "linking",
      schedule: { kind: "every", delayMs: 5_000 },
      run: () => {
        starts.push(time.clock.now());
        return current.promise;
      },
    };
    const scheduler = createScheduler([job], { ...time, logger: log.logger });
    scheduler.start();

    await time.advance(5_000);
    expect(starts).toEqual(["2026-10-30T07:00:05.000Z"]);
    // The run takes 60 s, twelve times its delay: no tick, no second run meanwhile.
    await time.advance(60_000);
    expect(starts).toHaveLength(1);
    expect(scheduler.isRunning("links")).toBe(true);
    expect(time.pending()).toBe(0);
    expect(scheduler.trigger("links")).toBe("already_running");
    expect(starts).toHaveLength(1);
    expect(log.events()).toContain("linking.job.skipped");

    const first = current;
    current = gate();
    first.release();
    await flush();
    expect(scheduler.isRunning("links")).toBe(false);
    await time.advance(4_999);
    expect(starts).toHaveLength(1);
    await time.advance(1);
    expect(starts).toEqual(["2026-10-30T07:00:05.000Z", "2026-10-30T07:01:10.000Z"]);
    expect(log.lines.find((l) => l["msg"] === "linking.job.finished")).toMatchObject({ job: "links", durationMs: 60_000 });
  });

  it("AC2: a run that throws is logged as <context>.job.failed and rescheduled after its delay", async () => {
    const time = fakeTime(START);
    const log = capture();
    let runs = 0;
    const job: Job = {
      name: "reconcile",
      context: "orders",
      schedule: { kind: "every", delayMs: 60 * 60_000 },
      run: () => {
        runs++;
        if (runs === 1) throw new Error("report page failed");
      },
    };
    const scheduler = createScheduler([job], { ...time, logger: log.logger });
    scheduler.start();
    await time.advance(60 * 60_000);
    expect(runs).toBe(1);
    const failed = log.lines.find((l) => l["msg"] === "orders.job.failed");
    expect(failed).toMatchObject({ job: "reconcile", level: 50 });
    expect(JSON.stringify(failed)).toContain("report page failed");
    await time.advance(60 * 60_000 - 1);
    expect(runs).toBe(1);
    await time.advance(1);
    expect(runs).toBe(2);
    expect(log.events()).toContain("orders.job.finished");
  });

  it("AC2: an async rejection is handled the same way", async () => {
    const time = fakeTime(START);
    const log = capture();
    let runs = 0;
    const scheduler = createScheduler(
      [{ name: "health", context: "operations", schedule: { kind: "every", delayMs: 60_000 }, run: () => (runs++, Promise.reject(new Error("bridge down"))) }],
      { ...time, logger: log.logger },
    );
    scheduler.start();
    await time.advance(120_000);
    expect(runs).toBe(2);
    expect(log.events().filter((e) => e === "operations.job.failed")).toHaveLength(2);
  });

  it("AC3: the nightly sweep's next run from a fixed clock is 02:00 Vietnam time, 19:00 UTC the day before", async () => {
    const time = fakeTime(START);
    expect(delayUntilNextRun(JOB_SCHEDULES.nightlySweep.schedule, time.clock)).toBe(12 * 60 * 60_000);
    expect(delayUntilNextRun(JOB_SCHEDULES.backup.schedule, time.clock)).toBe(13 * 60 * 60_000);

    const starts: string[] = [];
    const scheduler = createScheduler([{ name: "nightlySweep", ...JOB_SCHEDULES.nightlySweep, run: () => void starts.push(time.clock.now()) }], { ...time, logger: capture().logger });
    scheduler.start();
    await time.advance(2 * 24 * 60 * 60_000);
    expect(starts).toEqual(["2026-10-30T19:00:00.000Z", "2026-10-31T19:00:00.000Z"]);
  });

  it("AC4: shutdown waits for the current run, starts no new run and cancels every pending one", async () => {
    const time = fakeTime(START);
    const log = capture();
    const running = gate();
    let linkRuns = 0;
    let reconcileRuns = 0;
    const scheduler = createScheduler(
      [
        { name: "links", context: "linking", schedule: { kind: "every", delayMs: 5_000 }, run: () => (linkRuns++, running.promise) },
        { name: "reconcile", context: "orders", schedule: { kind: "every", delayMs: 60 * 60_000 }, run: () => void reconcileRuns++ },
      ],
      { ...time, logger: log.logger },
    );
    scheduler.start();
    await time.advance(5_000);
    expect(linkRuns).toBe(1);

    let stopped: unknown = null;
    const stopping = scheduler.stop(30_000).then((result) => (stopped = result));
    await time.advance(10_000);
    expect(stopped).toBeNull();
    expect(scheduler.trigger("reconcile")).toBe("stopping");
    running.release();
    await time.advance(0);
    await stopping;
    expect(stopped).toEqual({ finished: true, stillRunning: [] });
    await time.advance(2 * 60 * 60_000);
    expect({ linkRuns, reconcileRuns }).toEqual({ linkRuns: 1, reconcileRuns: 0 });
    expect(time.pending()).toBe(0);
    expect(log.events()).toContain("platform.jobs.stopped");
  });

  it("AC4: shutdown gives up at its timeout and names the job still running", async () => {
    const time = fakeTime(START);
    const scheduler = createScheduler([{ name: "backup", context: "platform", schedule: { kind: "every", delayMs: 1_000 }, run: () => new Promise<void>(() => undefined) }], {
      ...time,
      logger: capture().logger,
    });
    scheduler.start();
    await time.advance(1_000);
    const result = scheduler.stop(30_000);
    await time.advance(30_000);
    await expect(result).resolves.toEqual({ finished: false, stillRunning: ["backup"] });
  });
});

describe("the scheduler's own rules", () => {
  it("holds the AD-13 delays", () => {
    expect(JOB_SCHEDULES).toEqual({
      links: { context: "linking", schedule: { kind: "every", delayMs: 5_000 } },
      claimExpiry: { context: "payouts", schedule: { kind: "every", delayMs: 60_000 } },
      health: { context: "operations", schedule: { kind: "every", delayMs: 60_000 } },
      reconcile: { context: "orders", schedule: { kind: "every", delayMs: 3_600_000 } },
      nightlySweep: { context: "orders", schedule: { kind: "daily_vn", at: { hour: 2, minute: 0 } } },
      backup: { context: "platform", schedule: { kind: "daily_vn", at: { hour: 3, minute: 0 } } },
      payoutRecords: { context: "payouts", schedule: { kind: "every", delayMs: 3_600_000 } },
    });
  });

  it("refuses two jobs with one name and a delay that is not a positive whole number", () => {
    const options = { ...fakeTime(START), logger: capture().logger };
    const job = (name: string, delayMs: number): Job => ({ name, context: "platform", schedule: { kind: "every", delayMs }, run: () => undefined });
    expect(() => createScheduler([job("a", 1), job("a", 1)], options)).toThrow("two jobs named a");
    expect(() => createScheduler([job("a", 0)], options)).toThrow(RangeError);
    expect(() => createScheduler([job("a", 1.5)], options)).toThrow(RangeError);
  });

  it("a manual trigger runs now and moves the next run to a delay after it", async () => {
    const time = fakeTime(START);
    const starts: string[] = [];
    const scheduler = createScheduler([{ name: "claimExpiry", ...JOB_SCHEDULES.claimExpiry, run: () => void starts.push(time.clock.now()) }], { ...time, logger: capture().logger });
    scheduler.start();
    await time.advance(30_000);
    expect(scheduler.trigger("claimExpiry")).toBe("started");
    expect(scheduler.trigger("nope")).toBe("unknown_job");
    await time.advance(60_000);
    expect(starts).toEqual(["2026-10-30T07:00:30.000Z", "2026-10-30T07:01:30.000Z"]);
    expect(time.pending()).toBe(1);
  });
  it("owns one timer per job: a trigger before start, then two runs, leaves exactly one schedule", async () => {
    const time = fakeTime(START);
    const starts: string[] = [];
    const scheduler = createScheduler([{ name: "links", ...JOB_SCHEDULES.links, run: () => void starts.push(time.clock.now()) }], { ...time, logger: capture().logger });
    expect(scheduler.trigger("links")).toBe("started");
    await time.advance(0);
    // Not started yet: the run ends without scheduling anything.
    expect(time.pending()).toBe(0);
    scheduler.start();
    expect(time.pending()).toBe(1);
    await time.advance(5_000);
    expect(time.pending()).toBe(1);
    await time.advance(5_000);
    expect(time.pending()).toBe(1);
    expect(starts).toEqual(["2026-10-30T07:00:00.000Z", "2026-10-30T07:00:05.000Z", "2026-10-30T07:00:10.000Z"]);
  });

  it("start while a triggered run is still going schedules once, after that run ends", async () => {
    const time = fakeTime(START);
    const running = gate();
    let runs = 0;
    const scheduler = createScheduler([{ name: "links", ...JOB_SCHEDULES.links, run: () => (runs++, runs === 1 ? running.promise : undefined) }], { ...time, logger: capture().logger });
    scheduler.trigger("links");
    scheduler.start();
    expect(time.pending()).toBe(0);
    running.release();
    await time.advance(0);
    expect(time.pending()).toBe(1);
    await time.advance(5_000);
    expect(runs).toBe(2);
    expect(time.pending()).toBe(1);
  });

  it("a stale timer callback never runs the job or clears the current timer", async () => {
    const time = fakeTime(START);
    const fired: (() => void)[] = [];
    const timer = { schedule: (fn: () => void) => (fired.push(fn), fired.length), cancel: () => undefined };
    let runs = 0;
    const scheduler = createScheduler([{ name: "links", ...JOB_SCHEDULES.links, run: () => void runs++ }], { clock: time.clock, timer, logger: capture().logger });
    scheduler.start();
    scheduler.trigger("links");
    await flush();
    // The timer from start was replaced; firing it late (a timer that ignored cancel) does nothing.
    fired[0]?.();
    await flush();
    expect(runs).toBe(1);
    fired[1]?.();
    await flush();
    expect(runs).toBe(2);
  });
});
