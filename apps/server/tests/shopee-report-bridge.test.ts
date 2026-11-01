/**
 * Story 5.9: the Shopee conversion report is read page by page through the browser bridge, yields
 * to link jobs between pages, fails whole at the page cap (D43), and feeds the hourly run like any
 * source: idempotent over overlapping runs, UNPAID awaiting (D38). The bridge is the real adapter's
 * queue driven by hand, or a fake port; nothing reaches a browser or Shopee.
 */
import type { BridgeReportValue } from "@cashback/contracts";
import { fixedClock, toMs, type Clock } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";

import { linkEffectsFor } from "../src/links/link-jobs";
import { browserBridge, fakeBridge, queueLinkRequest, reportSeconds, runLinkJob, shopeeBridgeSource, type BridgeTimer, type ReportWindow, type ShopeeBridgeSourceDeps } from "../src/modules/linking/index";
import { alertsFor } from "../src/modules/operations/index";
import type { Ledger } from "../src/platform/db/ledger";
import { createLogger } from "../src/platform/log/logger";
import type { BridgePort, BridgeReportResult, ReportBridgeJob } from "../src/platform/ports/bridge.port";
import { hourlyWindow, runHourlyReconcile, type ReconcileContext } from "../src/reconcile/hourly-reconcile.job";
import { reconcileSources, UNWIRED_SHOPEE_SOURCE } from "../src/reconcile/reconcile-jobs";
import { healthOf } from "../src/admin/overview-activity.query";
import { assertIsolated, parseConfig } from "../src/platform/config/env.config";
import { closeLedgers, freshLedger, HOUR, movingClock } from "./helpers/order-ledger";

afterEach(closeLedgers);

const silent = createLogger({ destination: { write: () => undefined } });
const NOW = "2026-10-30T07:00:00.000Z";
const NO_TIMERS: BridgeTimer = { schedule: () => null, cancel: () => undefined };
const INSTANCE = "c".repeat(32);
const NEVER = new AbortController().signal;
const PURCHASED = Math.floor(toMs(fixedClock("2026-10-28T03:00:00.000Z").now()) / 1000);

interface ConversionSpec {
  orderStatus?: string;
  itemStatus?: string;
  commission?: number;
  utm?: string;
  purchaseTime?: number;
}

/** One conversion as the report page renders it (the live `report_reader.py` shape), amounts x100,000. */
type Conversion = BridgeReportValue["list"][number];

function conversion(orderSn: string, spec: ConversionSpec = {}): Conversion {
  return {
    checkout_id: `CK${orderSn}`,
    purchase_time: spec.purchaseTime ?? PURCHASED,
    utm_content: spec.utm ?? "C1-REQ1---",
    orders: [{ order_sn: orderSn, order_status: spec.orderStatus ?? "PAID", items: [{ item_id: `${orderSn}1`, display_item_status: spec.itemStatus ?? "Pending", item_commission: (spec.commission ?? 5000) * 100_000, capped_brand_commission: 0, actual_amount: 100_000 * 100_000 }] }],
  };
}

const conversions = (count: number, from = 0) => Array.from({ length: count }, (_, i) => conversion(`2610280000${String(from + i).padStart(4, "0")}`));

/** A fake bridge whose report pages answer from `pages` (page n is pages[n - 1]) with the stated total. */
function reportBridge(pages: Conversion[][], total: number | null = pages.flat().length, answer?: (job: ReportBridgeJob) => BridgeReportResult | null): BridgePort & { jobs: ReportBridgeJob[] } {
  const jobs: ReportBridgeJob[] = [];
  const fake = fakeBridge();
  return {
    mode: "browser",
    jobs,
    createLink: fake.createLink,
    readReportPage: async (job) => {
      jobs.push(job);
      return answer?.(job) ?? { outcome: "value", value: { page: job.page, total, list: pages[job.page - 1] ?? [] } };
    },
  };
}

function sourceDeps(ledger: Ledger, bridge: BridgePort, clock: Clock, extra: Partial<ShopeeBridgeSourceDeps> = {}): ShopeeBridgeSourceDeps {
  return { bridge, ledger, clock, wait: () => new Promise((r) => setImmediate(r)), alerts: (db) => alertsFor(db, clock), ...extra };
}

const context = (ledger: Ledger, bridge: BridgePort, clock = movingClock(NOW), extra: Partial<ShopeeBridgeSourceDeps> = {}): ReconcileContext & { clock: ReturnType<typeof movingClock> } => ({
  ledger,
  clock,
  logger: silent,
  sources: [shopeeBridgeSource(sourceDeps(ledger, bridge, clock, extra))],
  production: true,
  monotonic: () => 0,
});

const all = (ledger: Ledger, sql: string) => ledger.sqlite.prepare(sql).all() as Record<string, unknown>[];
const TRACKED = ["orders", "order_items", "order_status_history", "order_observations", "outbox", "ledger_entries", "review_cases"];
const snapshot = (ledger: Ledger) => Object.fromEntries(TRACKED.map((t) => [t, all(ledger, `SELECT * FROM ${t} ORDER BY rowid`).map((r) => (t === "orders" ? { ...r, last_seen_in_report_at: null } : r))]));

describe("Story 5.9 AC1: link jobs go first between report pages", () => {
  it("AC1: with a 3-page report and a link request arriving after page 1, the link job is served before page 2", async () => {
    const ledger = freshLedger();
    const clock = fixedClock(NOW);
    let n = 0;
    const bridge = browserBridge({ timer: NO_TIMERS, makeTicket: () => (++n).toString(16).padStart(32, "0") });
    const window: ReportWindow = hourlyWindow(clock);
    const reading = shopeeBridgeSource(sourceDeps(ledger, bridge, clock)).read(window, NEVER);
    const served: string[] = [];
    const take = async () => {
      const job = await bridge.work.next(INSTANCE, NEVER);
      if (job === null) throw new Error("no job");
      served.push(job.kind === "report" ? `report ${job.page}` : job.kind);
      return job;
    };
    const page1 = await take();
    expect(page1).toMatchObject({ kind: "report", page: 1, ...reportSeconds(window) });
    const requestId = ledger.tx((db) => queueLinkRequest(db, { customer: "C1", url: "https://shopee.vn/Ao-i.11001.22001", channel: "zalo" }, clock)).requestId;
    const linking = runLinkJob({ ledger, clock, bridge, subIdPrefix: "", logger: silent, effects: linkEffectsFor(clock) }, NEVER);
    bridge.work.deliver({ ticket: page1.ticket, outcome: "value", value: { page: 1, total: 120, list: conversions(50) } }, INSTANCE);
    const link = await take();
    bridge.work.deliver({ ticket: link.ticket, outcome: "link", url: `https://shopee.vn/product/11001/22001?utm_content=C1-${requestId}---` }, INSTANCE);
    expect(await linking).toMatchObject({ issued: 1 });
    const page2 = await take();
    bridge.work.deliver({ ticket: page2.ticket, outcome: "value", value: { page: 2, total: 120, list: conversions(50, 50) } }, INSTANCE);
    const page3 = await take();
    bridge.work.deliver({ ticket: page3.ticket, outcome: "value", value: { page: 3, total: 120, list: conversions(20, 100) } }, INSTANCE);
    expect((await reading).rows).toHaveLength(120);
    expect(served).toEqual(["report 1", "link", "report 2", "report 3"]);
  });

  it("AC1: while a link request is due, the next page waits on the server and is asked for only once the link is served", async () => {
    const ledger = freshLedger();
    const clock = fixedClock(NOW);
    const bridge = reportBridge([conversions(50), conversions(10, 50)]);
    const waits: number[] = [];
    let requestId = "";
    const wait = async (ms: number) => {
      waits.push(ms);
      if (waits.length === 2) ledger.sqlite.prepare("UPDATE link_requests SET status = 'ISSUED' WHERE request_id = ?").run(requestId);
      await Promise.resolve();
    };
    const source = shopeeBridgeSource(sourceDeps(ledger, bridge, clock, { wait }));
    const reading = source.read(hourlyWindow(clock), NEVER);
    requestId = ledger.tx((db) => queueLinkRequest(db, { customer: "C1", url: "https://shopee.vn/Ao-i.11001.22001", channel: "zalo" }, clock)).requestId;
    expect((await reading).rows).toHaveLength(60);
    expect(waits).toEqual([1_000, 1_000]);
    expect(bridge.jobs.map((j) => j.page)).toEqual([1, 2]);
  });
});

describe("Story 5.9 AC2: the page cap fails the run whole", () => {
  it("AC2: a slice that needs more than 20 full pages fails report_page_cap, changes no order and raises the alert", async () => {
    const ledger = freshLedger();
    const pages = Array.from({ length: 25 }, (_, p) => conversions(50, p * 50));
    const bridge = reportBridge(pages, 1_250);
    const [run] = await runHourlyReconcile(context(ledger, bridge));
    expect(run).toMatchObject({ network: "shopee", outcome: "FAILED", errorCode: "report_page_cap", rowsRead: 0, applied: 0 });
    expect(bridge.jobs.map((j) => j.page)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(all(ledger, "SELECT * FROM orders")).toEqual([]);
    expect(all(ledger, "SELECT kind FROM alerts")).toEqual([{ kind: "reconciliation_page_cap" }]);
  });

  it("AC2: pages that keep holding fewer rows than the stated total fail after a second read and change nothing", async () => {
    const short = freshLedger();
    const bridge = reportBridge([conversions(30)], 45);
    expect((await runHourlyReconcile(context(short, bridge)))[0]).toMatchObject({ outcome: "FAILED", errorCode: "report_fetch_failed" });
    expect(bridge.jobs.map((j) => j.page)).toEqual([1, 1]);
    expect(all(short, "SELECT * FROM orders")).toEqual([]);
  });
});

describe("Story 5.9 AC3: two hourly runs over the same report", () => {
  it("AC3: the second run changes no order: every row is a fingerprint skip", async () => {
    const ledger = freshLedger();
    const list = [conversion("261028AAAA0001"), conversion("261028AAAA0002", { itemStatus: "Validated", commission: 12000 }), conversion("261028AAAA0003", { itemStatus: "Cancelled", commission: 0 })];
    const ctx = context(ledger, reportBridge([list]));
    const [first] = await runHourlyReconcile(ctx);
    expect(first).toMatchObject({ outcome: "SUCCEEDED", rowsRead: 3, applied: 3 });
    const before = snapshot(ledger);
    ctx.clock.advance(HOUR);
    const [second] = await runHourlyReconcile(ctx);
    expect(second).toMatchObject({ outcome: "SUCCEEDED", rowsRead: 3, applied: 0, skipped: 3 });
    expect(snapshot(ledger)).toEqual(before);
  });
});

describe("Story 5.9 AC4: UNPAID is awaiting, never a cancel (D38)", () => {
  it("AC4: report rows of UNPAID orders are applied and stay AWAITING_APPROVAL", async () => {
    const ledger = freshLedger();
    const list = [conversion("261028UNPD0001", { orderStatus: "UNPAID", itemStatus: "" }), conversion("261028UNPD0002", { orderStatus: "UNPAID", itemStatus: "Pending" })];
    await runHourlyReconcile(context(ledger, reportBridge([list])));
    expect(all(ledger, "SELECT order_id, status FROM orders ORDER BY order_id")).toEqual([
      { order_id: "261028UNPD0001", status: "AWAITING_APPROVAL" },
      { order_id: "261028UNPD0002", status: "AWAITING_APPROVAL" },
    ]);
  });
});

describe("Story 5.9: the browser session and the report page are trusted only as far as checked", () => {
  it("a captcha page holds the Shopee queue with the bridge_captcha alert, the login page pauses it, and either fails the run", async () => {
    const held = freshLedger();
    const captcha = reportBridge([], null, () => ({ outcome: "failed", reason: "captcha" }));
    expect((await runHourlyReconcile(context(held, captcha)))[0]).toMatchObject({ outcome: "FAILED", errorCode: "report_fetch_failed" });
    expect(all(held, "SELECT held_reason FROM link_queue_state")).toEqual([{ held_reason: "captcha" }]);
    expect(all(held, "SELECT kind FROM alerts")).toContainEqual({ kind: "bridge_captcha" });
    const paused = freshLedger();
    const login = reportBridge([], null, () => ({ outcome: "failed", reason: "login_redirect" }));
    await runHourlyReconcile(context(paused, login));
    expect(all(paused, "SELECT paused_reason FROM link_queue_state")).toEqual([{ paused_reason: "login_redirect" }]);
    expect(all(paused, "SELECT kind FROM alerts")).toContainEqual({ kind: "bridge_login_lost" });
  });

  it("no page is asked for while the Shopee queue is held or paused", async () => {
    const ledger = freshLedger();
    ledger.sqlite.exec("INSERT INTO link_queue_state (queue, paused_reason, paused_at) VALUES ('shopee', 'login_redirect', '2026-10-30T06:00:00.000Z')");
    const bridge = reportBridge([conversions(3)]);
    expect((await runHourlyReconcile(context(ledger, bridge)))[0]).toMatchObject({ outcome: "FAILED", errorCode: "report_source_unavailable" });
    expect(bridge.jobs).toEqual([]);
  });

  it("a page that shows another page number, a row that is no conversion, or rows outside the window fail the read", async () => {
    const clock = fixedClock(NOW);
    const read = (bridge: BridgePort) => shopeeBridgeSource(sourceDeps(freshLedger(), bridge, clock)).read(hourlyWindow(clock), NEVER);
    await expect(read(reportBridge([], null, () => ({ outcome: "value", value: { page: 2, total: null, list: [] } })))).rejects.toMatchObject({ code: "report_fetch_failed" });
    await expect(read(reportBridge([[{ checkout_id: "1", payout: 3 }]]))).rejects.toMatchObject({ code: "report_fetch_failed" });
    await expect(read(reportBridge([[conversion("261001OLD00001", { purchaseTime: PURCHASED - 30 * 86_400 })]]))).rejects.toMatchObject({ code: "report_fetch_failed" });
    await expect(read(reportBridge([], null, () => ({ outcome: "unavailable", reason: "no_bridge" })))).rejects.toMatchObject({ code: "report_source_unavailable" });
    await expect(read(fakeBridge())).rejects.toMatchObject({ code: "report_source_unavailable" });
  });

  it("production reads Shopee through the bridge and ignores a saved file; dev reads a saved file when one is set", () => {
    const ledger = freshLedger();
    const clock = fixedClock(NOW);
    const wiring = { bridge: reportBridge([]), ledger, clock, wait: async () => undefined };
    const prod = parseConfig("prod", { INTERNAL_TOKEN: "x".repeat(32), SHOPEE_REPORT_PATH: "C:/reports/shopee.csv", BRIDGE_TOKEN: "b".repeat(40), ASSISTANT_TOKEN: "a".repeat(40) });
    expect(reconcileSources(prod, wiring).map((s) => s.network)).toEqual(["shopee"]);
    expect(reconcileSources(prod, { ...wiring, bridge: fakeBridge() })).toEqual([UNWIRED_SHOPEE_SOURCE]);
    const dev = parseConfig("dev", { INTERNAL_TOKEN: "x".repeat(32), SHOPEE_REPORT_PATH: "C:/reports/shopee.csv" });
    expect(reconcileSources(dev, { ...wiring, bridge: fakeBridge() }).map((s) => s.network)).toEqual(["shopee"]);
  });
});

describe("Story 5.9 review: a live report moves while it is read, and no order is lost", () => {
  it("review 2: a purchase landing between two pages makes the read start again from page 1 once, and every order is reconciled", async () => {
    const ledger = freshLedger();
    const before = conversions(60);
    const landed = conversion("261028NEW00001");
    const after = [landed, ...before];
    let reads = 0;
    // Page 1 is read before the purchase lands; from page 2 on the report already holds it (newest first).
    const bridge = reportBridge([], null, (job) => {
      reads++;
      const list = reads === 1 ? before : after;
      return { outcome: "value", value: { page: job.page, total: list.length, list: list.slice((job.page - 1) * 50, job.page * 50) } };
    });
    const [run] = await runHourlyReconcile(context(ledger, bridge));
    expect(bridge.jobs.map((j) => j.page)).toEqual([1, 2, 1, 2]);
    expect(run).toMatchObject({ outcome: "SUCCEEDED", rowsRead: 61, applied: 61 });
    expect(all(ledger, "SELECT count(*) AS n FROM orders")).toEqual([{ n: 61 }]);
  });

  it("review 2: a conversion shown again on the next page with the same content is kept once; with different content the read fails", async () => {
    const same = freshLedger();
    const [run] = await runHourlyReconcile(context(same, reportBridge([conversions(50), conversions(5, 49)], null)));
    expect(run).toMatchObject({ outcome: "SUCCEEDED", rowsRead: 54 });
    const changed = freshLedger();
    const moved = { ...conversions(1, 49)[0], utm_content: "C2-REQ2---" } as Conversion;
    const [failed] = await runHourlyReconcile(context(changed, reportBridge([conversions(50), [moved]], null)));
    expect(failed).toMatchObject({ outcome: "FAILED", errorCode: "report_fetch_failed" });
    expect(all(changed, "SELECT * FROM orders")).toEqual([]);
  });

  it("review 2: a report that keeps moving fails after two reads from page 1, never a half-read", async () => {
    const ledger = freshLedger();
    let total = 70;
    const bridge = reportBridge([], null, (job) => ({ outcome: "value", value: { page: job.page, total: total++, list: conversions(job.page === 1 ? 50 : 20, (job.page - 1) * 50) } }));
    expect((await runHourlyReconcile(context(ledger, bridge)))[0]).toMatchObject({ outcome: "FAILED", errorCode: "report_fetch_failed" });
    expect(bridge.jobs.map((j) => j.page)).toEqual([1, 2, 1, 2]);
    expect(all(ledger, "SELECT * FROM orders")).toEqual([]);
  });

  it("review 4: a row without a readable purchase time fails the read: the page may have ignored the window", async () => {
    const clock = fixedClock(NOW);
    const noTime = { ...conversion("261028NOTM0001"), purchase_time: null } as Conversion;
    await expect(shopeeBridgeSource(sourceDeps(freshLedger(), reportBridge([[noTime]]), clock)).read(hourlyWindow(clock), NEVER)).rejects.toMatchObject({ code: "report_fetch_failed" });
  });
});

describe("Story 5.9 review 3: production without a report-reading bridge is never silent", () => {
  it("review 3: every run records a FAILED Shopee run, the Overview's reconciliation health is down, and the repeated failure alerts", async () => {
    const ledger = freshLedger();
    const prod = parseConfig("prod", { INTERNAL_TOKEN: "x".repeat(32), BRIDGE_TOKEN: "b".repeat(40), ASSISTANT_TOKEN: "a".repeat(40) });
    const clock = movingClock(NOW);
    const sources = reconcileSources(prod, { bridge: fakeBridge(), ledger, clock, wait: async () => undefined });
    expect(sources).toEqual([UNWIRED_SHOPEE_SOURCE]);
    const ctx: ReconcileContext = { ledger, clock, logger: silent, sources, production: true, monotonic: () => 0 };
    expect((await runHourlyReconcile(ctx))[0]).toMatchObject({ network: "shopee", outcome: "FAILED", errorCode: "report_source_unavailable" });
    clock.advance(HOUR);
    await runHourlyReconcile(ctx);
    expect(healthOf(ledger.db, clock).find((h) => h.component === "reconciliation")).toEqual({ component: "reconciliation", state: "down", at: null });
    expect(all(ledger, "SELECT kind FROM alerts")).toContainEqual({ kind: "reconciliation_failed" });
  });

  it("review 3: production refuses to start with the fake bridge", () => {
    const fake = parseConfig("prod", { INTERNAL_TOKEN: "x".repeat(32), BRIDGE_TOKEN: "b".repeat(40), ASSISTANT_TOKEN: "a".repeat(40), BRIDGE_MODE: "fake" });
    expect(() => assertIsolated(fake)).toThrow(/BRIDGE_MODE/);
  });
});

describe("Story 5.9 review 6: an empty page past the last full one", () => {
  it("review 6: a report of exactly 50 rows with no stated total ends on an empty page 2, and the read succeeds", async () => {
    const ledger = freshLedger();
    const bridge = reportBridge([], null, (job) => ({ outcome: "value", value: job.page === 1 ? { page: 1, total: null, list: conversions(50) } : { page: job.page, total: null, list: [] } }));
    expect((await runHourlyReconcile(context(ledger, bridge)))[0]).toMatchObject({ outcome: "SUCCEEDED", rowsRead: 50 });
    expect(bridge.jobs.map((j) => j.page)).toEqual([1, 2]);
  });
});
