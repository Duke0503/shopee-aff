/**
 * Story 3.8: the nightly sweep reads, one paced day slice at a time, every older Vietnam day that
 * still holds an unresolved order, and nothing else; a slice at its page cap fails loudly and
 * changes nothing; R5 aging flags awaiting orders unseen for 14 days and counts those unseen for
 * over 60 (D43). Time is a fake clock moved by the sweep's own pauses; sources are fakes.
 */
import { instantFromMs, parseInstant, toMs, vnDateOf } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";

import { ReportSourceError, sourced, type ReportWindow, type SourcedRow, type WindowedReportSource } from "../src/modules/linking/index";
import { orderAging } from "../src/modules/orders/index";
import type { Ledger } from "../src/platform/db/ledger";
import { JOB_SCHEDULES } from "../src/platform/jobs/job-schedules";
import { createLogger } from "../src/platform/log/logger";
import { runHourlyReconcile } from "../src/reconcile/hourly-reconcile.job";
import { runNightlySweep, SWEEP_PACING, type SweepContext, type SweepPacing } from "../src/reconcile/nightly-sweep.job";
import { apply, approved, awaiting, closeLedgers, freshLedger, movingClock } from "./helpers/order-ledger";

afterEach(closeLedgers);

const all = (ledger: Ledger, sql: string) => ledger.sqlite.prepare(sql).all() as Record<string, unknown>[];
const silent = createLogger({ destination: { write: () => undefined } });
const MINUTE = 60_000;
const DAY = 86_400_000;
/** 02:00 on 30 October 2026, Vietnam time: when the scheduler starts the sweep. */
const SWEEP_START = "2026-10-29T19:00:00.000Z";

function onDay(row: SourcedRow, purchasedAt: string): SourcedRow {
  const { fingerprint: _f, purchasedAt: _p, ...plain } = row;
  return sourced(plain, parseInstant(purchasedAt));
}

function order(
  ledger: Ledger,
  id: string,
  o: {
    recordedAt: string;
    status?: string;
    lastSeen?: string | null;
    paidAt?: string | null;
    network?: string | null;
  },
): void {
  ledger.sqlite
    .prepare(
      "INSERT INTO orders (order_id, network, platform, customer_id, status, recorded_at, last_seen_in_report_at, paid_at, approved_commission, cashback, origin) VALUES (?, ?, 'shopee', 'C1', ?, ?, ?, ?, ?, ?, 'REPORT')",
    )
    .run(
      id,
      o.network === undefined ? "shopee" : o.network,
      o.status ?? "AWAITING_APPROVAL",
      o.recordedAt,
      o.lastSeen ?? null,
      o.paidAt ?? null,
      o.status === "APPROVED" || o.status === "PAID" ? 20000 : null,
      o.status === "APPROVED" || o.status === "PAID" ? 14243 : null,
    );
}

/** A fake source: the rows of each Vietnam day it is asked for; a day listed in `capped` is at its page cap. */
function daySource(network: "shopee" | "accesstrade", rows: SourcedRow[], capped: string[] = []): WindowedReportSource & { windows: ReportWindow[] } {
  const windows: ReportWindow[] = [];
  return {
    network,
    windows,
    read: (window) => {
      windows.push(window);
      if (capped.includes(vnDateOf(window.since))) return Promise.reject(new ReportSourceError("report_page_cap", "slice at its cap"));
      const inside = rows.filter((r) => r.purchasedAt !== null && r.purchasedAt >= window.since && r.purchasedAt < window.until);
      return Promise.resolve({
        network,
        source: `fake:${network}`,
        rows: inside,
        skippedLines: 0,
        sha256: null,
      });
    },
  };
}

function sweepContext(ledger: Ledger, sources: WindowedReportSource[], pacing: Partial<SweepPacing> = {}): SweepContext & { clock: ReturnType<typeof movingClock>; waits: number[] } {
  const clock = movingClock(SWEEP_START);
  const waits: number[] = [];
  return {
    ledger,
    clock,
    logger: silent,
    sources,
    production: true,
    monotonic: () => 0,
    pacing: { ...SWEEP_PACING, ...pacing },
    waits,
    wait: (ms) => {
      waits.push(ms);
      clock.advance(ms);
      return Promise.resolve();
    },
  };
}

const days = (source: { windows: ReportWindow[] }) => source.windows.map((w) => vnDateOf(w.since));

describe("Story 3.8 acceptance criteria", () => {
  it("AC1: open orders on 3 days of the last 90 read exactly those 3 day slices, and no others", async () => {
    const ledger = freshLedger();
    order(ledger, "260801OLD00001", { recordedAt: "2026-09-01T03:00:00.000Z" });
    order(ledger, "260801OLD00002", { recordedAt: "2026-09-01T10:00:00.000Z", status: "FROZEN" });
    order(ledger, "260915APPR0001", { recordedAt: "2026-09-15T03:00:00.000Z", status: "APPROVED" });
    order(ledger, "261010AWAI0001", { recordedAt: "2026-10-10T16:30:00.000Z" });
    // Not open: paid, rejected; too new for the sweep (the hourly reads it); another network.
    order(ledger, "260905PAID0001", {
      recordedAt: "2026-09-05T03:00:00.000Z",
      status: "PAID",
      paidAt: "2026-10-01T03:00:00.000Z",
    });
    order(ledger, "260906REJE0001", { recordedAt: "2026-09-06T03:00:00.000Z", status: "REJECTED" });
    order(ledger, "261027NEW00001", { recordedAt: "2026-10-27T03:00:00.000Z" });
    order(ledger, "AT0000000777", {
      recordedAt: "2026-09-20T03:00:00.000Z",
      network: "accesstrade",
    });
    const shopee = daySource("shopee", []);
    const result = await runNightlySweep(sweepContext(ledger, [shopee]));
    // 16:30 UTC on 10 October is 23:30 in Vietnam: still 10 October.
    expect(days(shopee).sort()).toEqual(["2026-09-01", "2026-09-15", "2026-10-10"]);
    expect(shopee.windows[0]).toMatchObject({
      since: expect.stringMatching(/T17:00:00\.000Z$/) as unknown,
    });
    expect(result.slices.map((s) => s.kind)).toEqual(["NIGHTLY", "NIGHTLY", "NIGHTLY"]);
    expect(all(ledger, "SELECT kind, network, window_from, window_to FROM reconciliation_runs WHERE window_from = '2026-09-14T17:00:00.000Z'")).toEqual([
      {
        kind: "NIGHTLY",
        network: "shopee",
        window_from: "2026-09-14T17:00:00.000Z",
        window_to: "2026-09-15T17:00:00.000Z",
      },
    ]);
  });

  it("AC2: an order approved 45 days after purchase becomes APPROVED with its cashback stored when its day is read", async () => {
    const ledger = freshLedger();
    const purchased = "2026-09-15T03:00:00.000Z";
    // Recorded by the hourly run in September, still awaiting at the end of October.
    apply(ledger, onDay(awaiting("260915LATE0001", [100000]), purchased), movingClock("2026-09-15T04:00:00.000Z"));
    const source = daySource("shopee", [onDay(approved("260915LATE0001", [100000]), purchased)]);
    await runNightlySweep(sweepContext(ledger, [source]));
    expect(days(source)).toEqual(["2026-09-15"]);
    expect(all(ledger, "SELECT status, approved_commission, cashback, cashback_withheld FROM orders")).toEqual([{ status: "APPROVED", approved_commission: 100000, cashback: 71216, cashback_withheld: 1 }]);
  });

  it("AC3: a slice at its page cap fails the run loudly, changes no order and raises an alert", async () => {
    const ledger = freshLedger();
    order(ledger, "260901CAPP0001", {
      recordedAt: "2026-09-01T03:00:00.000Z",
      lastSeen: "2026-10-01T00:00:00.000Z",
    });
    order(ledger, "260902CAPP0002", {
      recordedAt: "2026-09-02T03:00:00.000Z",
      lastSeen: "2026-10-02T00:00:00.000Z",
    });
    const before = all(ledger, "SELECT * FROM orders ORDER BY order_id");
    const source = daySource("shopee", [onDay(approved("260901CAPP0001"), "2026-09-01T03:00:00.000Z")], ["2026-09-01"]);
    const result = await runNightlySweep(sweepContext(ledger, [source]));
    expect(result.slices).toMatchObject([{ outcome: "FAILED", errorCode: "report_page_cap", rowsRead: 0, applied: 0 }]);
    expect(result.afterFailure).toBe(1);
    expect(all(ledger, "SELECT * FROM orders ORDER BY order_id")).toEqual(before);
    expect(all(ledger, "SELECT kind, severity FROM alerts")).toEqual([{ kind: "reconciliation_page_cap", severity: "high" }]);
  });

  it("AC4: an awaiting order last seen 15 days ago is flagged by a review case; at 61 days it counts as aged", async () => {
    const ledger = freshLedger();
    const now = parseInstant(SWEEP_START);
    const ago = (n: number) => instantFromMs(toMs(now) - n * DAY);
    order(ledger, "261001SEEN0013", { recordedAt: ago(20), lastSeen: ago(13) });
    order(ledger, "261001SEEN0015", { recordedAt: ago(20), lastSeen: ago(15) });
    order(ledger, "260801SEEN0061", { recordedAt: ago(70), lastSeen: ago(61) });
    order(ledger, "260801APPR0061", { recordedAt: ago(70), lastSeen: ago(61), status: "APPROVED" });
    // Aging trusts Shopee only after a successful hourly run in the last 24 hours.
    await runHourlyReconcile(sweepContext(ledger, [daySource("shopee", [])]));
    const result = await runNightlySweep(sweepContext(ledger, [daySource("shopee", [])]));
    expect(result.flagged).toBe(2);
    expect(all(ledger, "SELECT subject, reason, candidates, fingerprint FROM review_cases ORDER BY subject")).toEqual([
      {
        subject: "260801SEEN0061",
        reason: "not_seen_in_report",
        candidates: '["C1"]',
        fingerprint: null,
      },
      {
        subject: "261001SEEN0015",
        reason: "not_seen_in_report",
        candidates: '["C1"]',
        fingerprint: null,
      },
    ]);
    expect(ledger.tx((db) => orderAging(db, now))).toEqual({ flagged: 2, aged: 1 });
    // The next night keeps the one case per order; nothing about the order or its money changes.
    const again = await runNightlySweep(sweepContext(ledger, [daySource("shopee", [])]));
    expect(again.flagged).toBe(0);
    expect(all(ledger, "SELECT count(*) AS n FROM review_cases")).toEqual([{ n: 2 }]);
    expect(all(ledger, "SELECT status FROM orders WHERE order_id = '261001SEEN0015'")).toEqual([{ status: "AWAITING_APPROVAL" }]);
  });

  it("AC5: the sweep and the hourly run over the same day give the result of one run", async () => {
    const purchased = "2026-10-20T03:00:00.000Z";
    const rows = [onDay(approved("261020BOTH0001", [100000]), purchased), onDay(awaiting("261020BOTH0002"), purchased)];
    const unwindowed = (): WindowedReportSource => ({
      network: "shopee",
      read: () => Promise.resolve({ network: "shopee", source: "fake", rows, skippedLines: 0, sha256: null }),
    });
    const TABLES = ["orders", "order_items", "order_status_history", "order_observations", "outbox", "ledger_entries", "review_cases", "audit_entries"];
    const state = (ledger: Ledger) => Object.fromEntries(TABLES.map((t) => [t, all(ledger, `SELECT * FROM ${t} ORDER BY rowid`).map((r) => (t === "orders" ? { ...r, last_seen_in_report_at: null } : r))]));

    const once = freshLedger();
    await runHourlyReconcile({ ...sweepContext(once, [unwindowed()]) });
    const both = freshLedger();
    const ctx = sweepContext(both, [unwindowed()]);
    await runHourlyReconcile(ctx);
    await runNightlySweep({ ...ctx, pacing: { ...ctx.pacing, maxAgeDays: 90 } });
    expect(all(both, "SELECT kind, skipped, applied FROM reconciliation_runs ORDER BY run_id")).toEqual([
      { kind: "HOURLY", skipped: 0, applied: 2 },
      { kind: "NIGHTLY", skipped: 2, applied: 0 },
    ]);
    expect(state(both)).toEqual(state(once));
  });
});

describe("Story 3.8: schedule and pacing", () => {
  it("runs at 02:00 Vietnam time and stops starting slices before the 03:00 backup (AD-13)", () => {
    expect(JOB_SCHEDULES.nightlySweep.schedule).toEqual({
      kind: "daily_vn",
      at: { hour: 2, minute: 0 },
    });
    const stop = SWEEP_PACING.stopAt.hour * 60 + SWEEP_PACING.stopAt.minute;
    const backup = JOB_SCHEDULES.backup.schedule;
    if (backup.kind !== "daily_vn") throw new Error("the backup runs at a Vietnam time of day");
    expect(stop).toBeGreaterThan(2 * 60);
    expect(stop).toBeLessThan(backup.at.hour * 60 + backup.at.minute);
  });

  it("pauses between slices and leaves the days it cannot start before the stop time for the next night, stalest first", async () => {
    const ledger = freshLedger();
    order(ledger, "260901PACE0001", {
      recordedAt: "2026-09-01T03:00:00.000Z",
      lastSeen: "2026-10-04T00:00:00.000Z",
    });
    order(ledger, "260902PACE0002", {
      recordedAt: "2026-09-02T03:00:00.000Z",
      lastSeen: "2026-10-01T00:00:00.000Z",
    });
    order(ledger, "260903PACE0003", { recordedAt: "2026-09-03T03:00:00.000Z", lastSeen: null });
    order(ledger, "260904PACE0004", {
      recordedAt: "2026-09-04T03:00:00.000Z",
      lastSeen: "2026-10-03T00:00:00.000Z",
    });
    const source = daySource("shopee", []);
    const ctx = sweepContext(ledger, [source], { pauseMs: 20 * MINUTE });
    const result = await runNightlySweep(ctx);
    // 02:00, 02:20 and 02:40 start; the fourth would start at 03:00, after the 02:50 stop.
    expect(days(source)).toEqual(["2026-09-03", "2026-09-02", "2026-09-04"]);
    expect(ctx.waits).toEqual([20 * MINUTE, 20 * MINUTE, 20 * MINUTE]);
    expect(result.notReached).toBe(1);
  });

  it("does not read days older than the report keeps, and an order of no network is looked for in every network", async () => {
    const ledger = freshLedger();
    order(ledger, "260601TOOOLD01", { recordedAt: "2026-06-01T03:00:00.000Z" });
    order(ledger, "260910NONET001", { recordedAt: "2026-09-10T03:00:00.000Z", network: null });
    const shopee = daySource("shopee", []);
    const accesstrade = daySource("accesstrade", []);
    const result = await runNightlySweep(sweepContext(ledger, [shopee, accesstrade], { pauseMs: 0 }));
    expect(days(shopee)).toEqual(["2026-09-10"]);
    expect(days(accesstrade)).toEqual(["2026-09-10"]);
    expect(result.beyondWindow).toBe(1);
  });
});
