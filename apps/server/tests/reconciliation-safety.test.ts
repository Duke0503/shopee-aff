/**
 * Review of Sprints 9-10: what keeps reconciliation honest when its inputs are not. R5 aging
 * trusts only a network read tonight; the scheduler's stop ends a sweep without touching the
 * ledger; a saved file re-read unchanged for over 24 hours is stale and moves no last-seen time;
 * a wall clock that steps back never breaks a run row; a saved file is parsed once while unchanged.
 */
import { utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { instantFromMs, parseInstant, toMs, vnDateOf, type Instant } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";

import { accessTradeFileWindowSource, cachedFileReport, ReportSourceError, type ReportWindow, type SourcedReport, type SourcedRow, type WindowedReportSource } from "../src/modules/linking/index";
import type { Ledger } from "../src/platform/db/ledger";
import { JOB_SCHEDULES } from "../src/platform/jobs/job-schedules";
import { createScheduler } from "../src/platform/jobs/scheduler";
import { createLogger } from "../src/platform/log/logger";
import { reconcileWindow, runHourlyReconcile, type ReconcileContext } from "../src/reconcile/hourly-reconcile.job";
import { runNightlySweep, SWEEP_PACING, timerWait, type SweepContext } from "../src/reconcile/nightly-sweep.job";
import { fakeTime } from "./helpers/fake-time";
import { tempDir } from "./helpers/live-fixture";
import { awaiting, closeLedgers, freshLedger, HOUR, movingClock } from "./helpers/order-ledger";

afterEach(closeLedgers);

const all = (ledger: Ledger, sql: string) => ledger.sqlite.prepare(sql).all() as Record<string, unknown>[];
const silent = createLogger({ destination: { write: () => undefined } });
const DAY = 86_400_000;
const SWEEP_START = "2026-10-29T19:00:00.000Z";

function order(ledger: Ledger, id: string, network: string, recordedAt: Instant, lastSeen: Instant): void {
  ledger.sqlite
    .prepare("INSERT INTO orders (order_id, network, platform, customer_id, status, recorded_at, last_seen_in_report_at, origin) VALUES (?, ?, 'shopee', 'C1', 'AWAITING_APPROVAL', ?, ?, 'REPORT')")
    .run(id, network, recordedAt, lastSeen);
}

function fixed(network: "shopee" | "accesstrade", answer: readonly SourcedRow[] | Error, extra: Partial<SourcedReport> = {}): WindowedReportSource & { windows: ReportWindow[] } {
  const windows: ReportWindow[] = [];
  return {
    network,
    windows,
    read: (window) => {
      windows.push(window);
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve({ network, source: `fake:${network}`, rows: answer, skippedLines: 0, sha256: null, ...extra });
    },
  };
}

function base(ledger: Ledger, sources: WindowedReportSource[], clock = movingClock(SWEEP_START)): ReconcileContext & { clock: ReturnType<typeof movingClock> } {
  return { ledger, clock, logger: silent, sources, production: true, monotonic: () => 0 };
}

const sweep = (ctx: ReconcileContext): SweepContext => ({ ...ctx, pacing: { ...SWEEP_PACING, pauseMs: 0 }, wait: () => Promise.resolve() });

describe("review item 1: R5 aging trusts only a network read tonight", () => {
  const now = parseInstant(SWEEP_START);
  const ago = (n: number) => instantFromMs(toMs(now) - n * DAY);
  const flaggedOrders = (ledger: Ledger) => all(ledger, "SELECT subject FROM review_cases WHERE reason = 'not_seen_in_report' ORDER BY subject").map((r) => r.subject);

  it("flags nothing of a network that has no source configured", async () => {
    const ledger = freshLedger();
    order(ledger, "261001SHOP0015", "shopee", ago(20), ago(15));
    order(ledger, "AT0000000015", "accesstrade", ago(20), ago(15));
    const ctx = base(ledger, [fixed("accesstrade", [])]);
    await runHourlyReconcile(ctx);
    const result = await runNightlySweep(sweep(ctx));
    expect(result.trusted).toEqual(["accesstrade"]);
    expect(flaggedOrders(ledger)).toEqual(["AT0000000015"]);
  });

  it("flags nothing of a network whose read failed tonight, even after a good hourly run", async () => {
    const ledger = freshLedger();
    order(ledger, "AT0000000016", "accesstrade", ago(20), ago(15));
    await runHourlyReconcile(base(ledger, [fixed("accesstrade", [])]));
    const result = await runNightlySweep(sweep(base(ledger, [fixed("accesstrade", new ReportSourceError("report_fetch_failed", "503"))])));
    expect(result.slices).toMatchObject([{ outcome: "FAILED" }]);
    expect(result.trusted).toEqual([]);
    expect(flaggedOrders(ledger)).toEqual([]);
  });

  it("flags nothing of a network whose hourly run has not succeeded in the last 24 hours", async () => {
    const ledger = freshLedger();
    order(ledger, "AT0000000017", "accesstrade", ago(20), ago(15));
    const earlier = movingClock(SWEEP_START);
    earlier.advance(-25 * HOUR);
    await runHourlyReconcile(base(ledger, [fixed("accesstrade", [])], earlier));
    const result = await runNightlySweep(sweep(base(ledger, [fixed("accesstrade", [])])));
    expect(result.trusted).toEqual([]);
    expect(flaggedOrders(ledger)).toEqual([]);
  });
});

describe("review item 2: the scheduler's stop ends the sweep and the ledger is not touched after it", () => {
  it("a stop during the pause between slices cancels the pause, starts no slice and skips the aging pass", async () => {
    const ledger = freshLedger();
    const time = fakeTime(SWEEP_START);
    order(ledger, "260901STOP0001", "shopee", "2026-09-01T03:00:00.000Z" as Instant, "2026-10-01T00:00:00.000Z" as Instant);
    order(ledger, "260902STOP0002", "shopee", "2026-09-02T03:00:00.000Z" as Instant, "2026-10-02T00:00:00.000Z" as Instant);
    const source = fixed("shopee", []);
    const ctx: ReconcileContext = { ledger, clock: time.clock, logger: silent, sources: [source], production: true, monotonic: () => 0 };
    let finished: unknown = "running";
    const scheduler = createScheduler(
      [
        {
          name: "nightlySweep",
          ...JOB_SCHEDULES.nightlySweep,
          run: async (signal) => void (finished = await runNightlySweep({ ...ctx, signal, pacing: { ...SWEEP_PACING, pauseMs: 10 * 60_000 }, wait: timerWait(time.timer) })),
        },
      ],
      { clock: time.clock, timer: time.timer, logger: silent },
    );
    expect(scheduler.trigger("nightlySweep")).toBe("started");
    await time.advance(60_000);
    expect(source.windows).toHaveLength(1);
    const audits = all(ledger, "SELECT count(*) AS n FROM audit_entries");
    const stopping = scheduler.stop(30_000);
    await time.advance(0);
    await expect(stopping).resolves.toEqual({ finished: true, stillRunning: [] });
    expect(finished).toMatchObject({ stopped: true, flagged: 0 });
    await time.advance(60 * 60_000);
    expect(source.windows).toHaveLength(1);
    expect(all(ledger, "SELECT count(*) AS n FROM reconciliation_runs")).toEqual([{ n: 1 }]);
    expect(all(ledger, "SELECT count(*) AS n FROM audit_entries")).toEqual(audits);
    expect(time.pending()).toBe(0);
  });

  it("a stop during a read records nothing and applies nothing from it", async () => {
    const ledger = freshLedger();
    const stop = new AbortController();
    const slow: WindowedReportSource = {
      network: "shopee",
      read: (_window, signal) => {
        stop.abort();
        expect(signal?.aborted).toBe(true);
        return Promise.resolve({ network: "shopee", source: "fake", rows: [awaiting("261028STOP0003")], skippedLines: 0, sha256: null });
      },
    };
    const ctx = { ...base(ledger, [slow], movingClock("2026-10-30T07:00:00.000Z")), signal: stop.signal };
    expect(await runHourlyReconcile(ctx)).toEqual([]);
    expect(all(ledger, "SELECT count(*) AS n FROM reconciliation_runs")).toEqual([{ n: 0 }]);
    expect(all(ledger, "SELECT count(*) AS n FROM orders")).toEqual([{ n: 0 }]);
  });
});

describe("review item 3: a saved file re-read unchanged for over 24 hours is stale", () => {
  it("records SOURCE_STALE, moves no last-seen time, alerts once per cooldown, and is fresh again once the file changes", async () => {
    const ledger = freshLedger();
    const clock = movingClock("2026-10-30T07:00:00.000Z");
    const file = { sha256: "a".repeat(64), modifiedAt: "2026-10-30T06:00:00.000Z" as Instant };
    const rows = [awaiting("261028FILE0001")];
    const ctx = base(ledger, [fixed("shopee", rows, file)], clock);
    const lastSeen = () => all(ledger, "SELECT last_seen_in_report_at AS at FROM orders")[0]?.at;
    await runHourlyReconcile(ctx);
    clock.advance(23 * HOUR);
    const [fresh] = await runHourlyReconcile(ctx);
    expect(fresh).toMatchObject({ outcome: "SUCCEEDED", skipped: 1 });
    expect(lastSeen()).toBe(clock.now());
    const seen = clock.now();

    clock.advance(2 * HOUR);
    const [stale] = await runHourlyReconcile(ctx);
    expect(stale).toMatchObject({ outcome: "SOURCE_STALE", errorCode: "source_stale", rowsRead: 1, skipped: 0, applied: 0 });
    expect(lastSeen()).toBe(seen);
    clock.advance(10 * 60_000);
    await runHourlyReconcile(ctx);
    expect(all(ledger, "SELECT kind, severity, suppressed FROM alerts")).toEqual([{ kind: "reconciliation_source_stale", severity: "high", suppressed: 1 }]);
    expect(all(ledger, "SELECT source_sha256, source_modified_at FROM reconciliation_runs WHERE run_id = 1")).toEqual([{ source_sha256: file.sha256, source_modified_at: file.modifiedAt }]);

    clock.advance(HOUR);
    const [changed] = await runHourlyReconcile(base(ledger, [fixed("shopee", rows, { ...file, sha256: "b".repeat(64) })], clock));
    expect(changed).toMatchObject({ outcome: "SUCCEEDED", skipped: 1 });
    expect(lastSeen()).toBe(clock.now());
  });

  it("an API read (no checksum) is never stale", async () => {
    const ledger = freshLedger();
    const clock = movingClock("2026-10-30T07:00:00.000Z");
    const ctx = base(ledger, [fixed("accesstrade", [])], clock);
    await runHourlyReconcile(ctx);
    clock.advance(48 * HOUR);
    expect((await runHourlyReconcile(ctx))[0]).toMatchObject({ outcome: "SUCCEEDED" });
  });
});

describe("review item 4: run durations come from a monotonic clock", () => {
  it("a wall clock stepping back during the run holds finished_at at started_at, notes the step and keeps the monotonic duration", async () => {
    const ledger = freshLedger();
    const clock = movingClock("2026-10-30T07:00:00.000Z");
    let mono = 1000;
    const stepping: WindowedReportSource = {
      network: "shopee",
      read: () => {
        clock.advance(-2 * HOUR);
        mono += 1500;
        return Promise.resolve({ network: "shopee", source: "fake", rows: [], skippedLines: 0, sha256: null });
      },
    };
    const run = await reconcileWindow({ ...base(ledger, [stepping], clock), monotonic: () => mono }, "HOURLY", stepping, { since: "2026-10-24T17:00:00.000Z" as Instant, until: "2026-10-30T07:00:00.000Z" as Instant });
    expect(run).toMatchObject({ outcome: "SUCCEEDED" });
    expect(all(ledger, "SELECT started_at, finished_at, duration_ms, clock_stepped FROM reconciliation_runs")).toEqual([
      { started_at: "2026-10-30T07:00:00.000Z", finished_at: "2026-10-30T07:00:00.000Z", duration_ms: 1500, clock_stepped: 1 },
    ]);
  });
});

describe("review item 7: a saved file is read, parsed and hashed once while unchanged", () => {
  it("parses again only when the file's modification time or size changes, and carries both checksum and time", () => {
    const path = join(tempDir("cashback-file-cache-"), "at.json");
    writeFileSync(path, "[]");
    utimesSync(path, 1_790_000_000, 1_790_000_000);
    let parses = 0;
    const report = cachedFileReport(path, () => {
      parses++;
      return { network: "accesstrade", source: "file:at.json", rows: [], skippedLines: 0, sha256: "c".repeat(64) };
    });
    const first = report();
    expect(report()).toBe(first);
    expect(parses).toBe(1);
    expect(first.modifiedAt).toBe(instantFromMs(1_790_000_000_000));
    writeFileSync(path, "[ ]");
    utimesSync(path, 1_790_000_100, 1_790_000_100);
    report();
    expect(parses).toBe(2);
  });

  it("the AccessTrade file source answers every day slice from one parse, with the file's checksum", async () => {
    const path = join(tempDir("cashback-file-cache-"), "at.json");
    writeFileSync(path, JSON.stringify({ data: [], total: 0 }));
    const source = accessTradeFileWindowSource(path);
    const a = await source.read({ since: "2026-09-01T17:00:00.000Z" as Instant, until: "2026-09-02T17:00:00.000Z" as Instant });
    const b = await source.read({ since: "2026-09-02T17:00:00.000Z" as Instant, until: "2026-09-03T17:00:00.000Z" as Instant });
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(b.sha256).toBe(a.sha256);
    expect(b.modifiedAt).toBe(a.modifiedAt);
    expect(vnDateOf(a.modifiedAt as Instant)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
