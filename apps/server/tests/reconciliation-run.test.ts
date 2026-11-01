/**
 * Story 3.7: the hourly reconciliation reads each enabled network for the last 7 Vietnam days
 * outside any transaction, applies the rows one transaction each, and writes one insert-only
 * `reconciliation_runs` row per network, a failed run's included (AD-8, AD-13, D43, R6).
 */
import { afterEach, describe, expect, it } from "vitest";

import { ReportSourceError, sourced, withinWindow, type ReportWindow, type SourcedReport, type SourcedRow, type WindowedReportSource } from "../src/modules/linking/index";
import { createLogger } from "../src/platform/log/logger";
import { JOB_SCHEDULES } from "../src/platform/jobs/job-schedules";
import type { Ledger } from "../src/platform/db/ledger";
import { hourlyWindow, runHourlyReconcile, type ReconcileContext } from "../src/reconcile/hourly-reconcile.job";
import { reconcileJobs, reconcileSources } from "../src/reconcile/reconcile-jobs";
import { systemTimer } from "../src/platform/jobs/scheduler";
import { parseConfig } from "../src/platform/config/env.config";
import { approved, awaiting, cancelled, closeLedgers, freshLedger, HOUR, movingClock } from "./helpers/order-ledger";

afterEach(closeLedgers);

const all = (ledger: Ledger, sql: string) => ledger.sqlite.prepare(sql).all() as Record<string, unknown>[];
const silent = createLogger({ destination: { write: () => undefined } });

type Answer = readonly SourcedRow[] | Error;

/** A source that answers from a script, one answer per read (the last one repeats), and records each window. */
function scripted(network: "shopee" | "accesstrade", answers: Answer[], onRead?: () => void): WindowedReportSource & { windows: ReportWindow[] } {
  const windows: ReportWindow[] = [];
  return {
    network,
    windows,
    read: async (window) => {
      windows.push(window);
      onRead?.();
      await Promise.resolve();
      const answer = answers.length > 1 ? answers.shift() : answers[0];
      if (answer instanceof Error) throw answer;
      return {
        network,
        source: `fake:${network}`,
        rows: answer ?? [],
        skippedLines: 0,
        sha256: null,
      } satisfies SourcedReport;
    },
  };
}

function context(ledger: Ledger, sources: WindowedReportSource[], clock = movingClock("2026-10-30T07:00:00.000Z")): ReconcileContext & { clock: ReturnType<typeof movingClock> } {
  return { ledger, clock, logger: silent, sources, production: true, monotonic: () => 0 };
}

const TRACKED = ["orders", "order_items", "order_status_history", "order_observations", "outbox", "ledger_entries", "review_cases", "campaign_awards"];
const snapshot = (ledger: Ledger) => Object.fromEntries(TRACKED.map((t) => [t, all(ledger, `SELECT * FROM ${t} ORDER BY rowid`).map((r) => (t === "orders" ? { ...r, last_seen_in_report_at: null } : r))]));
const runs = (ledger: Ledger) => all(ledger, "SELECT * FROM reconciliation_runs ORDER BY run_id");

describe("Story 3.7 acceptance criteria", () => {
  it("AC1: a run writes one reconciliation_runs row with network, window, rows read, applied, skipped, cases opened and duration", async () => {
    const ledger = freshLedger();
    const rows = [awaiting("261028HOUR0001"), approved("261028HOUR0002"), awaiting("261028HOUR0003", [20000], { subIds: ["", "", "", "", ""] })];
    const ctx = context(ledger, [scripted("shopee", [rows])]);
    const clock = ctx.clock;
    const [run] = await runHourlyReconcile(ctx);
    expect(run).toMatchObject({
      outcome: "SUCCEEDED",
      rowsRead: 3,
      applied: 2,
      unrecorded: 1,
      skipped: 0,
      casesOpened: 1,
    });
    expect(runs(ledger)).toEqual([
      {
        run_id: 1,
        kind: "HOURLY",
        network: "shopee",
        source: "fake:shopee",
        source_sha256: null,
        source_modified_at: null,
        window_from: "2026-10-23T17:00:00.000Z",
        window_to: clock.now(),
        started_at: clock.now(),
        finished_at: clock.now(),
        duration_ms: 0,
        clock_stepped: 0,
        outcome: "SUCCEEDED",
        error_code: null,
        rows_read: 3,
        applied: 2,
        skipped: 0,
        deferred: 0,
        unrecorded: 1,
        frozen: 0,
        cases_opened: 1,
        failed_rows: 0,
      },
    ]);
    expect(() => ledger.sqlite.exec("UPDATE reconciliation_runs SET applied = 0")).toThrow(/insert_only/);
    expect(() => ledger.sqlite.exec("DELETE FROM reconciliation_runs")).toThrow(/insert_only/);
  });

  it("AC2: two runs over overlapping windows with the same report change no order, amount, history or outbox row", async () => {
    const ledger = freshLedger();
    const rows = [approved("261028OVER0001", [100000]), cancelled("261028OVER0002"), awaiting("261028OVER0003")];
    const ctx = context(ledger, [scripted("shopee", [rows])]);
    await runHourlyReconcile(ctx);
    const after = snapshot(ledger);
    ctx.clock.advance(HOUR);
    const [second] = await runHourlyReconcile(ctx);
    expect(second).toMatchObject({
      outcome: "SUCCEEDED",
      rowsRead: 3,
      skipped: 3,
      applied: 0,
      casesOpened: 0,
    });
    expect(snapshot(ledger)).toEqual(after);
    expect(all(ledger, "SELECT DISTINCT last_seen_in_report_at AS at FROM orders")).toEqual([{ at: ctx.clock.now() }]);
  });

  it("AC3: one failed read raises no alert; the second failure in a row raises one high reconciliation_failed alert", async () => {
    const ledger = freshLedger();
    const down = new ReportSourceError("report_fetch_failed", "AccessTrade answered 503 on page 1");
    const ctx = context(ledger, [scripted("accesstrade", [down, down, []])]);
    await runHourlyReconcile(ctx);
    expect(all(ledger, "SELECT * FROM alerts")).toEqual([]);
    ctx.clock.advance(HOUR);
    await runHourlyReconcile(ctx);
    expect(all(ledger, "SELECT kind, severity FROM alerts")).toEqual([{ kind: "reconciliation_failed", severity: "high" }]);
    ctx.clock.advance(HOUR);
    await runHourlyReconcile(ctx);
    expect(runs(ledger).map((r) => [r.outcome, r.error_code, r.source])).toEqual([
      ["FAILED", "report_fetch_failed", null],
      ["FAILED", "report_fetch_failed", null],
      ["SUCCEEDED", null, "fake:accesstrade"],
    ]);
  });

  it("AC4: a read at the page cap fails the run, changes and freezes nothing, and alerts the owner", async () => {
    const ledger = freshLedger();
    const first = context(ledger, [scripted("shopee", [[approved("261028CAPS0001")]])]);
    await runHourlyReconcile(first);
    const before = snapshot(ledger);
    const capped = context(ledger, [scripted("shopee", [new ReportSourceError("report_page_cap", "20 full pages")])], first.clock);
    const [run] = await runHourlyReconcile(capped);
    expect(run).toMatchObject({
      outcome: "FAILED",
      errorCode: "report_page_cap",
      rowsRead: 0,
      applied: 0,
      frozen: 0,
    });
    expect(snapshot(ledger)).toEqual(before);
    expect(all(ledger, "SELECT kind, severity FROM alerts")).toEqual([{ kind: "reconciliation_page_cap", severity: "high" }]);
  });

  it("AC5: no ledger transaction is open while the network is read", async () => {
    const ledger = freshLedger();
    const open: boolean[] = [];
    const ctx = context(ledger, [scripted("shopee", [[awaiting("261028NOTX0001")]], () => open.push(ledger.sqlite.inTransaction))]);
    await runHourlyReconcile(ctx);
    expect(open).toEqual([false]);
  });
});

describe("Story 3.7: window, networks and row failures", () => {
  it("reads the last 7 Vietnam days, today included, up to now; the job runs every 60 minutes", () => {
    const clock = movingClock("2026-10-30T18:30:00.000Z");
    // 01:30 on 31 October in Vietnam: the window starts at 00:00 on 25 October, Vietnam time.
    expect(hourlyWindow(clock)).toEqual({
      since: "2026-10-24T17:00:00.000Z",
      until: "2026-10-30T18:30:00.000Z",
    });
    expect(JOB_SCHEDULES.reconcile).toEqual({
      context: "orders",
      schedule: { kind: "every", delayMs: 60 * 60_000 },
    });
  });

  it("each network is read and recorded on its own; one failing source does not stop the next", async () => {
    const ledger = freshLedger();
    const shopee = scripted("shopee", [new ReportSourceError("report_source_unavailable", "bridge")]);
    const accesstrade = scripted("accesstrade", [
      [
        awaiting("AT0000000099", [50000], {
          network: "accesstrade",
          subIds: ["C1", "REQT", "", "", ""],
        }),
      ],
    ]);
    const ctx = context(ledger, [shopee, accesstrade]);
    await runHourlyReconcile(ctx);
    expect(runs(ledger).map((r) => [r.network, r.outcome, r.applied])).toEqual([
      ["shopee", "FAILED", 0],
      ["accesstrade", "SUCCEEDED", 1],
    ]);
    expect(shopee.windows).toEqual(accesstrade.windows);
  });

  it("a row whose apply throws is rolled back alone; the rest are applied and the run is marked failed", async () => {
    const ledger = freshLedger();
    ledger.sqlite.exec(
      "INSERT INTO orders (order_id, network, platform, customer_id, status, approved_commission, cashback, paid_at, origin) VALUES ('260910NOCUST01', 'shopee', 'shopee', NULL, 'PAID', 100000, 71216, '2026-10-05T03:00:00.000Z', 'CUTOVER')",
    );
    const ctx = context(ledger, [scripted("shopee", [[cancelled("260910NOCUST01"), awaiting("261028GOOD0001")]])]);
    const [run] = await runHourlyReconcile(ctx);
    expect(run).toMatchObject({
      outcome: "FAILED",
      errorCode: "row_apply_failed",
      rowsRead: 2,
      applied: 1,
      failedRows: 1,
    });
    expect(all(ledger, "SELECT order_id, status FROM orders ORDER BY order_id")).toEqual([
      { order_id: "260910NOCUST01", status: "PAID" },
      { order_id: "261028GOOD0001", status: "AWAITING_APPROVAL" },
    ]);
    expect(all(ledger, "SELECT * FROM ledger_entries")).toEqual([]);
  });

  it("a frozen order is counted in the run", async () => {
    const ledger = freshLedger();
    const ctx = context(ledger, [scripted("shopee", [[approved("261028FRZC0001")], [approved("261028FRZC0001", [10000])]])]);
    await runHourlyReconcile(ctx);
    ctx.clock.advance(HOUR);
    const [run] = await runHourlyReconcile(ctx);
    expect(run).toMatchObject({ frozen: 1, casesOpened: 1, applied: 1 });
  });
});

describe("Story 3.7: sources and jobs as the server starts them", () => {
  const config = (extra: Record<string, string> = {}) => parseConfig("dev", { INTERNAL_TOKEN: "x".repeat(32), ...extra });

  it("reads AccessTrade from its API when its key is set and Shopee from a saved report when its path is set", () => {
    expect(reconcileSources(config()).map((s) => s.network)).toEqual([]);
    expect(reconcileSources(config({ ACCESSTRADE_API_KEY: "key", SHOPEE_REPORT_PATH: "C:/reports/shopee.csv" })).map((s) => s.network)).toEqual(["shopee", "accesstrade"]);
  });

  it("registers the hourly run and the nightly sweep with the AD-13 schedules", () => {
    const ledger = freshLedger();
    const jobs = reconcileJobs({
      config: config(),
      ledger,
      clock: movingClock("2026-10-30T07:00:00.000Z"),
      timer: systemTimer,
      logger: silent,
    });
    expect(jobs.map((j) => [j.name, j.context, j.schedule])).toEqual([
      ["reconcile", "orders", JOB_SCHEDULES.reconcile.schedule],
      ["nightlySweep", "orders", JOB_SCHEDULES.nightlySweep.schedule],
    ]);
  });
});

describe("Story 3.7: a saved report cut to the run's window", () => {
  it("keeps the rows purchased inside the half-open window and the rows without a purchase time", () => {
    const at = (orderId: string, purchasedAt: string | null) => {
      const { fingerprint: _f, purchasedAt: _p, ...plain } = awaiting(orderId);
      return sourced(plain, purchasedAt as never);
    };
    const report: SourcedReport = {
      network: "shopee",
      source: "file:x.csv",
      skippedLines: 0,
      sha256: null,
      rows: [at("A", "2026-10-23T16:59:59.999Z"), at("B", "2026-10-23T17:00:00.000Z"), at("C", "2026-10-30T07:00:00.000Z"), at("D", null)],
    };
    const cut = withinWindow(report, {
      since: "2026-10-23T17:00:00.000Z" as never,
      until: "2026-10-30T07:00:00.000Z" as never,
    });
    expect(cut.rows.map((r) => r.orderId)).toEqual(["B", "D"]);
  });
});
