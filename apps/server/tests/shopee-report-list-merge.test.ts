/**
 * Production 2026-11-03: every hourly Shopee run failed with `conversion_changed`, because the
 * report list holds one checkout id in several entries with different content. Rows are keyed by
 * order number, as the live `report_reader.py` keyed them (`orders[0].order_sn`), every order of an
 * entry kept, and an order's entries put together. Only an order whose entries disagree fails the
 * read, after a second read from page 1 disagrees too. The fixture is shaped like the live answer
 * (tests/fixtures/shopee-report-list.json); nothing reaches a browser or Shopee.
 */
import { readFileSync } from "node:fs";
import type { BridgeReportValue } from "@cashback/contracts";
import { fixedClock, toMs, type Clock } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";

import { mergeShopeeOrders } from "../src/modules/linking/domain/shopee-report-merge";
import { fakeBridge, readShopeePages, shopeeBridgeSource, type ShopeeBridgeSourceDeps } from "../src/modules/linking/index";
import { alertsFor } from "../src/modules/operations/index";
import type { Ledger } from "../src/platform/db/ledger";
import { createLogger, type Logger } from "../src/platform/log/logger";
import type { BridgePort, BridgeReportResult, ReportBridgeJob } from "../src/platform/ports/bridge.port";
import { runHourlyReconcile, type ReconcileContext } from "../src/reconcile/hourly-reconcile.job";
import { closeLedgers, freshLedger, movingClock } from "./helpers/order-ledger";

afterEach(closeLedgers);

type Conversion = BridgeReportValue["list"][number];
const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/shopee-report-list.json", import.meta.url), "utf8")) as Record<"multiOrder" | "shopOrderOne" | "shopOrderTwo" | "splitFirst" | "splitSecond", Conversion>;
const { multiOrder, shopOrderOne, shopOrderTwo, splitFirst, splitSecond } = FIXTURE;

const NOW = "2026-10-30T07:00:00.000Z";
const PURCHASED = Math.floor(toMs(fixedClock("2026-10-28T03:00:00.000Z").now()) / 1000);

/** Plain one-order entries that fill page 1 to its 50 rows. */
const filler = (count: number): Conversion[] =>
  Array.from({ length: count }, (_, i) => {
    const orderSn = `261028FILL${String(i).padStart(4, "0")}`;
    return { checkout_id: `CK${orderSn}`, purchase_time: PURCHASED, utm_content: "C1-REQ1---", orders: [{ order_sn: orderSn, order_status: "PAID", items: [{ item_id: `${orderSn}1`, display_item_status: "Pending", item_commission: 5000 * 100_000, capped_brand_commission: 0, actual_amount: 100_000 * 100_000 }] }] };
  });

/** Page 1: 46 fillers and four entries; page 2: an entry of page 1 shown again (page shift) and the rest of an order split over both pages. */
const PAGES: Conversion[][] = [[...filler(46), multiOrder, shopOrderOne, shopOrderTwo, splitFirst], [shopOrderTwo, splitSecond]];

function reportBridge(answer: (job: ReportBridgeJob, read: number) => Conversion[], total: number | null = null): BridgePort & { jobs: ReportBridgeJob[] } {
  const jobs: ReportBridgeJob[] = [];
  let reads = 0;
  return {
    mode: "browser",
    jobs,
    createLink: fakeBridge().createLink,
    readReportPage: async (job): Promise<BridgeReportResult> => {
      jobs.push(job);
      if (job.page === 1) reads++;
      return { outcome: "value", value: { page: job.page, total, list: answer(job, reads) } };
    },
  };
}

const pagesOf = (pages: Conversion[][]) => (job: ReportBridgeJob) => pages[job.page - 1] ?? [];

function context(ledger: Ledger, bridge: BridgePort, logger: Logger): ReconcileContext {
  const clock: Clock = movingClock(NOW);
  const deps: ShopeeBridgeSourceDeps = { bridge, ledger, clock, wait: () => new Promise((r) => setImmediate(r)), alerts: (db) => alertsFor(db, clock) };
  return { ledger, clock, logger, sources: [shopeeBridgeSource(deps)], production: true, monotonic: () => 0 };
}

function capture() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({ level: "info", destination: { write: (line: string) => void lines.push(JSON.parse(line) as Record<string, unknown>) } });
  return { logger, lines };
}

const all = (ledger: Ledger, sql: string) => ledger.sqlite.prepare(sql).all() as Record<string, unknown>[];
const fixtureItems = (ledger: Ledger) => all(ledger, "SELECT order_id, line_no, item_id FROM order_items WHERE order_id LIKE '261028FIX%' ORDER BY order_id, line_no");

describe("production 2026-11-03: the report list is keyed by order number, as the live reader keyed it", () => {
  it("several orders under one checkout, one checkout over several entries, an order split over two pages and an entry shown again: every order is reconciled once, with every item", async () => {
    const ledger = freshLedger();
    const log = capture();
    const bridge = reportBridge(pagesOf(PAGES), 51);
    const [run] = await runHourlyReconcile(context(ledger, bridge, log.logger));
    expect(run).toMatchObject({ network: "shopee", outcome: "SUCCEEDED", errorCode: null, rowsRead: 51, applied: 51 });
    expect(bridge.jobs.map((j) => j.page)).toEqual([1, 2]);
    expect(all(ledger, "SELECT order_id, status FROM orders WHERE order_id LIKE '261028FIX%' ORDER BY order_id")).toEqual([
      { order_id: "261028FIXA0001", status: "AWAITING_APPROVAL" },
      { order_id: "261028FIXA0002", status: "AWAITING_APPROVAL" },
      { order_id: "261028FIXB0001", status: "AWAITING_APPROVAL" },
      { order_id: "261028FIXB0002", status: "AWAITING_APPROVAL" },
      { order_id: "261028FIXC0001", status: "AWAITING_APPROVAL" },
    ]);
    expect(fixtureItems(ledger)).toEqual([
      { order_id: "261028FIXA0001", line_no: 1, item_id: "9001" },
      { order_id: "261028FIXA0001", line_no: 2, item_id: "9002" },
      { order_id: "261028FIXA0002", line_no: 1, item_id: "9003" },
      { order_id: "261028FIXB0001", line_no: 1, item_id: "9004" },
      { order_id: "261028FIXB0002", line_no: 1, item_id: "9005" },
      { order_id: "261028FIXC0001", line_no: 1, item_id: "9006" },
      { order_id: "261028FIXC0001", line_no: 2, item_id: "9007" },
    ]);
    // Counts only: no order number, sub_id or amount in the read's log line.
    const read = log.lines.find((l) => l["msg"] === "orders.reconciliation.read");
    expect(read).toMatchObject({ network: "shopee", source: "bridge:conversion_report", entries: 51, checkouts: 49, orders: 51, rows: 51, repeatedEntries: 1, repeatedItems: 1, passes: 1 });
    expect(JSON.stringify(read)).not.toMatch(/261028|C1-REQ/);
  });

  it("a second run over the same report changes nothing: every order is a fingerprint skip", async () => {
    const ledger = freshLedger();
    const ctx = context(ledger, reportBridge(pagesOf(PAGES), 51), capture().logger);
    await runHourlyReconcile(ctx);
    const [second] = await runHourlyReconcile(ctx);
    expect(second).toMatchObject({ outcome: "SUCCEEDED", rowsRead: 51, applied: 0, skipped: 51 });
  });

  it("the same item shown with other content in two entries of one order reads again from page 1, and fails with conversion_changed when it disagrees again; nothing is applied", async () => {
    const ledger = freshLedger();
    const log = capture();
    const order = (splitSecond["orders"] as Record<string, unknown>[])[0] as Record<string, unknown>;
    const items = order["items"] as Record<string, unknown>[];
    const changed = { ...splitSecond, orders: [{ ...order, items: [{ ...items[0], display_item_status: "Validated" }, items[1]] }] } as Conversion;
    const bridge = reportBridge(pagesOf([PAGES[0] as Conversion[], [shopOrderTwo, changed]]));
    const [run] = await runHourlyReconcile(context(ledger, bridge, log.logger));
    expect(run).toMatchObject({ outcome: "FAILED", errorCode: "report_fetch_failed", rowsRead: 0, applied: 0 });
    expect(bridge.jobs.map((j) => j.page)).toEqual([1, 2, 1, 2]);
    expect(log.lines.find((l) => l["msg"] === "orders.reconciliation.read_failed")).toMatchObject({ reason: "conversion_changed" });
    expect(all(ledger, "SELECT * FROM orders")).toEqual([]);
  });

  it("an order that disagrees only during the first read (a change caught mid-read) is read again and reconciled", async () => {
    const ledger = freshLedger();
    const moved = { ...splitSecond, utm_content: "C2-REQ9---" } as Conversion;
    const bridge = reportBridge((job, read) => (read === 1 ? [PAGES[0] as Conversion[], [shopOrderTwo, moved]] : PAGES)[job.page - 1] ?? []);
    const [run] = await runHourlyReconcile(context(ledger, bridge, capture().logger));
    expect(run).toMatchObject({ outcome: "SUCCEEDED", rowsRead: 51 });
    expect(bridge.jobs.map((j) => j.page)).toEqual([1, 2, 1, 2]);
  });
});

describe("production 2026-11-03: putting an order's entries together", () => {
  it("keeps every order of an entry, each distinct item once, and an entry without an order number as it is", () => {
    const noOrder = { checkout_id: "247229500000009", purchase_time: PURCHASED, orders: [{ order_status: "PAID", items: [] }] };
    const merged = mergeShopeeOrders([multiOrder, shopOrderOne, shopOrderTwo, splitFirst, splitSecond, noOrder]);
    expect(merged.conflict).toBeNull();
    expect(merged.counts).toEqual({ entries: 6, checkouts: 4, orders: 6, repeatedItems: 1 });
    expect(merged.conversions.map((c) => (c["orders"] as Record<string, unknown>[]).map((o) => [o["order_sn"] ?? null, (o["items"] as unknown[]).length]))).toEqual([[["261028FIXA0001", 2]], [["261028FIXA0002", 1]], [["261028FIXB0001", 1]], [["261028FIXB0002", 1]], [["261028FIXC0001", 2]], [[null, 0]]]);
  });

  it("an item without an id is known by its content; items of one entry are never compared with each other", () => {
    const item = { display_item_status: "Pending", actual_amount: 100, item_commission: 5 };
    const entry = (items: unknown[]) => ({ checkout_id: "1", utm_content: "C1----", orders: [{ order_sn: "261028NOID0001", order_status: "PAID", items }] });
    const merged = mergeShopeeOrders([entry([item, item]), entry([item, { ...item, actual_amount: 200 }])]);
    expect(merged.conflict).toBeNull();
    expect((merged.conversions[0]?.["orders"] as { items: unknown[] }[])[0]?.items).toHaveLength(3);
    const sameId = mergeShopeeOrders([entry([{ ...item, item_id: 5, model_id: 1 }]), entry([{ ...item, item_id: 5, model_id: 2 }])]);
    expect(sameId.conflict).toBeNull();
    const disagree = mergeShopeeOrders([entry([{ ...item, item_id: 5 }]), entry([{ ...item, item_id: 5, display_item_status: "Cancelled" }])]);
    expect(disagree.conflict).toBe("261028NOID0001");
  });

  it("a saved file whose entries share a checkout id is read; the same entry saved twice still fails report_duplicate_page", () => {
    const rows = readShopeePages([multiOrder, shopOrderOne, shopOrderTwo, splitFirst, splitSecond], "saved");
    expect(rows.map((r) => [r.orderId, r.items.length])).toEqual([["261028FIXA0001", 2], ["261028FIXA0002", 1], ["261028FIXB0001", 1], ["261028FIXB0002", 1], ["261028FIXC0001", 2]]);
    expect(() => readShopeePages([multiOrder, shopOrderOne, multiOrder], "saved")).toThrow(expect.objectContaining({ code: "report_duplicate_page" }));
  });
});
