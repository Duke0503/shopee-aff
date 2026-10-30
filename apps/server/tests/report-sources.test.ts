/**
 * Story 2.8: the report sources of the shadow run. AccessTrade is read from a saved
 * `/v1/transactions` answer (or the API through a fake HTTP port; the real API is never called),
 * Shopee from the operator's export file (decision H10). Every source yields complete,
 * fingerprinted rows or fails with `report_page_cap`, and the Shopee source makes no network call.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseInstant } from "@cashback/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ACCESSTRADE_MAX_PAGES,
  ACCESSTRADE_TIMEOUT_MS,
  accessTradeApiSource,
  accessTradeFileSource,
  detectShopeeExportMapping,
  fingerprintRow,
  parseCsv,
  readAccessTradeFile,
  readExportAmount,
  readShopeeFile,
  readShopeePages,
  ReportSourceError,
  shopeeFileSource,
  type HttpGet,
  type ReportRow,
  type RowProblem,
  type SourcedRow,
} from "../src/modules/linking/index";
import { reportSignal } from "../src/modules/orders/index";
import { tempDir } from "./helpers/live-fixture";

const SHADOW = fileURLToPath(new URL("./fixtures/shadow", import.meta.url));
const fixture = (name: string) => join(SHADOW, name);

const EOL = String.fromCharCode(10);

const writeTemp = (name: string, content: string): string => {
  const path = join(tempDir("cashback-report-source-"), name);
  writeFileSync(path, content);
  return path;
};

const byId = (rows: readonly SourcedRow[], id: string): SourcedRow => {
  const row = rows.find((r) => r.orderId === id);
  if (!row) throw new Error(`no row ${id}`);
  return row;
};

describe("AC1: AccessTrade API response fixture", () => {
  const report = readAccessTradeFile(fixture("accesstrade-transactions.json"));

  it("makes one ReportRow per transaction with commissions in whole dong and a stable fingerprint", () => {
    expect(report.network).toBe("accesstrade");
    expect(report.rows.map((r) => r.orderId)).toEqual(["TT0000000000000017", "TT0000000000000020"]);
    const cancelled = byId(report.rows, "TT0000000000000017");
    expect(cancelled.items.map((i) => [i.status, i.commissionParts])).toEqual([
      ["CANCELLED", [10000]],
      ["CANCELLED", [5000]],
    ]);
    expect(byId(report.rows, "TT0000000000000020").items[0]).toMatchObject({ status: "APPROVED", commissionParts: [12000], value: 150000 });
    for (const row of report.rows) {
      expect(row.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      for (const part of row.items.flatMap((i) => i.commissionParts)) expect(Number.isSafeInteger(part)).toBe(true);
    }
    expect(cancelled.purchasedAt).toBe("2026-10-08T03:00:00.000Z");
  });

  it("reads a bare array of lines and an array of pages the same way", () => {
    const lines = (JSON.parse(readFileSync(fixture("accesstrade-transactions.json"), "utf8")) as { data: unknown[] }).data;
    const bare = readAccessTradeFile(writeTemp("bare.json", JSON.stringify(lines)));
    const pages = readAccessTradeFile(writeTemp("pages.json", JSON.stringify([{ data: lines.slice(0, 2), total: 3 }, { data: lines.slice(2), total: 3 }])));
    expect(bare.rows.map((r) => r.fingerprint)).toEqual(report.rows.map((r) => r.fingerprint));
    expect(pages.rows.map((r) => r.fingerprint)).toEqual(report.rows.map((r) => r.fingerprint));
  });
});

describe("AC2: Shopee export file with several items per order", () => {
  const report = readShopeeFile({ path: fixture("shopee-export.csv") });

  it("groups lines per order, keeps every item and maps statuses by the Story 1.11 map", () => {
    expect(report.rows.map((r) => r.orderId)).toEqual(["260912BBBB0002", "261004MMMM0013", "261003LLLL0012", "261008RRRR0021"]);
    const split = byId(report.rows, "261004MMMM0013");
    expect(split.orderStatus).toBe("AWAITING");
    expect(split.items.map((i) => [i.itemId, i.status, i.commissionParts, i.value])).toEqual([
      ["9131", "APPROVED", [10000], 100000],
      ["9132", "CANCELLED", [10000], 100000],
    ]);
    expect(reportSignal(split)).toEqual({ kind: "APPROVED", liveItems: [0] });
    expect(byId(report.rows, "261003LLLL0012")).toMatchObject({ orderStatus: "CANCELLED", subIds: ["1000000000000000003", "", "", "", ""] });
    expect(reportSignal(byId(report.rows, "261003LLLL0012"))).toEqual({ kind: "CANCEL", reason: "order_cancelled" });
  });

  it("falls back to the order status for an item without one, reads dong text and the purchase time in Vietnam time", () => {
    const row = byId(report.rows, "261008RRRR0021");
    expect(row.items[0]).toMatchObject({ rawStatus: "To Ship", status: "AWAITING", commissionParts: [2501], value: 50000 });
    expect(report.rows.find((r) => r.orderId === "260912BBBB0002")?.purchasedAt).toBe("2026-09-12T03:30:00.000Z");
    expect(report.skippedLines).toBe(1);
  });

  it("guesses the mapping from the headers, preferring the item status, and reads a report_mapping.json the same way", () => {
    const mapping = detectShopeeExportMapping(parseCsv("Order ID,Item ID,Order Status,Item Status,Commission,Sub_id1\n")[0] ?? []);
    expect(mapping).toMatchObject({ order_id: "Order ID", item_id: "Item ID", status: "Item Status", order_status: "Order Status", commission: "Commission", sub_id1: "Sub_id1" });
    const mappingPath = writeTemp("report_mapping.json", JSON.stringify(mapping));
    const mapped = readShopeeFile({ path: fixture("shopee-export.csv"), mappingPath });
    expect(mapped.rows.map((r) => r.fingerprint)).not.toEqual([]);
    expect(mapped.rows.map((r) => r.orderId)).toEqual(report.rows.map((r) => r.orderId));
  });

  it("reads Vietnamese headers through the live normalisation", () => {
    const vi = detectShopeeExportMapping(["M\u00E3 \u0111\u01A1n h\u00E0ng", "Tr\u1EA1ng th\u00E1i", "Hoa h\u1ED3ng", "Sub_id1"]);
    expect(vi).toMatchObject({ order_id: "M\u00E3 \u0111\u01A1n h\u00E0ng", status: "Tr\u1EA1ng th\u00E1i", commission: "Hoa h\u1ED3ng", sub_id1: "Sub_id1" });
  });

  it("reads plain amounts, rounding a fraction half-up, and freezes anything else (golden: shopee-export-amount.json)", () => {
    const problems: RowProblem[] = [];
    expect(["27.000", "27,000", "27000.00", " 27 000 d ", "27.000,50", "", "-"].map((t) => readExportAmount(t, problems))).toEqual([27000, 27000, 27000, 27000, 27001, null, null]);
    expect(problems).toEqual([]);
    for (const bad of ["-5.000", "2.7E+04", "1e5", "12 ab"]) expect(readExportAmount(bad, problems)).toBeNull();
    expect(problems).toEqual(["invalid_amount", "invalid_amount", "invalid_amount", "invalid_amount"]);
  });

  it("an export line with an unreadable amount freezes its own order only", () => {
    const path = writeTemp("bad-amount.csv", ["Order ID,Item Status,Commission,Sub_id1", "A1,Pending,2.7E+04,C1", "A2,Pending,1.000,C1", ""].join(EOL));
    const report = readShopeeFile({ path });
    expect(reportSignal(byId(report.rows, "A1"))).toEqual({ kind: "FREEZE", reason: "invalid_amount" });
    expect(reportSignal(byId(report.rows, "A2"))).toEqual({ kind: "AWAITING", liveItems: [0] });
  });

  it("reads the live classify_status words in English and Vietnamese with their Story 1.11 meaning (golden: shopee-export-status.json)", () => {
    const path = writeTemp("words.csv", ["Order ID,Item ID,Item Status,Commission,Sub_id1", "B1,1,Valid,1.000,C1", "B1,2,Returned,1.000,C1", "B2,1,da huy,1.000,C1", "B3,1,Completed,1.000,C1", "B4,1,On hold,1.000,C1", ""].join(EOL));
    const report = readShopeeFile({ path });
    expect(byId(report.rows, "B1").items.map((i) => i.status)).toEqual(["APPROVED", "CANCELLED"]);
    expect(reportSignal(byId(report.rows, "B1"))).toEqual({ kind: "APPROVED", liveItems: [0] });
    expect(reportSignal(byId(report.rows, "B2"))).toEqual({ kind: "CANCEL", reason: "all_items_cancelled" });
    expect(reportSignal(byId(report.rows, "B3"))).toEqual({ kind: "AWAITING", liveItems: [0] });
    expect(reportSignal(byId(report.rows, "B4"))).toEqual({ kind: "FREEZE", reason: "unknown_status" });
  });

  it("refuses an export whose required columns cannot be found", async () => {
    const path = writeTemp("bad.csv", "Order ID,Commission\n1,2\n");
    await expect(shopeeFileSource({ path }).read()).rejects.toMatchObject({ code: "report_mapping_incomplete" });
  });

  it("reads the report page JSON with every order of a conversion (R3)", () => {
    const json = readShopeeFile({ path: fixture("shopee-report.json") });
    expect(json.rows.filter((r) => r.orderId.startsWith("261002KKKK")).map((r) => r.orderId)).toEqual(["261002KKKK0011", "261002KKKK0018"]);
    expect(byId(json.rows, "261002KKKK0011").purchasedAt).toBe(parseInstant("2026-10-02T03:00:00.000Z"));
  });
});

const conversion = (orderSn: string) => ({ utm_content: "C1----", orders: [{ order_sn: orderSn, order_status: "PAID", items: [{ display_item_status: "Pending", item_commission: 100_000 }] }] });

describe("AC3: a read that reaches the page cap", () => {
  it("Shopee: saved pages holding fewer conversions than their total fail and yield nothing", async () => {
    const path = writeTemp("short.json", JSON.stringify({ data: { list: [conversion("A1")], total: 2 } }));
    await expect(shopeeFileSource({ path }).read()).rejects.toMatchObject({ code: "report_page_cap" });
    const full = Array.from({ length: 20 }, (_, p) => ({ list: Array.from({ length: 50 }, (_, i) => conversion(`P${p}I${i}`)) }));
    expect(() => readShopeePages(full, "pages")).toThrow(expect.objectContaining({ code: "report_page_cap" }));
  });

  it("AccessTrade file: lines fewer than the total fail and yield nothing", async () => {
    const path = writeTemp("short.json", JSON.stringify({ data: [{ transaction_id: "T1", status: 0, commission: 1 }], total: 5 }));
    await expect(accessTradeFileSource(path).read()).rejects.toBeInstanceOf(ReportSourceError);
    await expect(accessTradeFileSource(path).read()).rejects.toMatchObject({ code: "report_page_cap" });
  });

  const since = parseInstant("2026-10-01T00:00:00.000Z");
  const until = parseInstant("2026-10-30T00:00:00.000Z");

  it("AccessTrade API: still more pages after the cap fails with report_page_cap and no partial set", async () => {
    const urls: string[] = [];
    const get: HttpGet = (url) => {
      urls.push(url);
      const lines = Array.from({ length: 100 }, (_, i) => ({ transaction_id: `T${urls.length}-${i}`, status: 0, commission: 1000 }));
      return Promise.resolve({ status: 200, json: () => Promise.resolve({ data: lines, total: 5000 }) });
    };
    await expect(accessTradeApiSource({ apiKey: "k", since, until, get }).read()).rejects.toMatchObject({ code: "report_page_cap" });
    expect(urls).toHaveLength(ACCESSTRADE_MAX_PAGES);
    expect(urls[0]).toContain("/v1/transactions?since=2026-10-01T00%3A00%3A00Z&until=2026-10-30T00%3A00%3A00Z&limit=100&page=1");
  });

  it("AccessTrade API: reads every page until the total and sends the token header", async () => {
    const headers: Record<string, string>[] = [];
    const get: HttpGet = (url, h) => {
      headers.push({ ...h });
      const page = Number(new URL(url).searchParams.get("page"));
      const lines = page === 1 ? Array.from({ length: 100 }, (_, i) => ({ transaction_id: `T${i}`, status: 0, commission: 10 })) : [{ transaction_id: "T100", status: 1, is_confirmed: 1, commission: 10 }];
      return Promise.resolve({ status: 200, json: () => Promise.resolve({ data: lines, total: 101 }) });
    };
    const report = await accessTradeApiSource({ apiKey: "secret", since, until, get }).read();
    expect(report.rows).toHaveLength(101);
    expect(headers).toEqual([{ Authorization: "Token secret" }, { Authorization: "Token secret" }]);
  });

  it("AccessTrade API: refuses a window over 30 days and fails on an error answer", async () => {
    const get: HttpGet = () => Promise.resolve({ status: 500, json: () => Promise.resolve({}) });
    await expect(accessTradeApiSource({ apiKey: "k", since: parseInstant("2026-08-01T00:00:00.000Z"), until, get }).read()).rejects.toMatchObject({ code: "report_window_too_long" });
    await expect(accessTradeApiSource({ apiKey: "k", since, until, get }).read()).rejects.toMatchObject({ code: "report_fetch_failed" });
  });
});

describe("saved pages are complete and each saved once", () => {
  const page = (n: number | undefined, ids: string[]) => ({ ...(n === undefined ? {} : { page_num: n }), list: ids.map((id) => ({ ...conversion(id), checkout_id: `K${id}` })), total: 3 });

  it("reads numbered pages from 1 without a gap, in any file order", () => {
    expect(readShopeePages([page(2, ["C"]), page(1, ["A", "B"])], "pages").map((r) => r.orderId)).toEqual(["C", "A", "B"]);
  });

  it("refuses a page number saved twice and a conversion saved twice with report_duplicate_page", () => {
    expect(() => readShopeePages([page(1, ["A", "B"]), page(1, ["C"])], "pages")).toThrow(expect.objectContaining({ code: "report_duplicate_page" }));
    expect(() => readShopeePages([page(undefined, ["A", "B", "C"]), page(undefined, ["A", "B", "C"])], "pages")).toThrow(expect.objectContaining({ code: "report_duplicate_page" }));
  });

  it("refuses pages that do not start at 1, have a gap, or are partly unnumbered", () => {
    expect(() => readShopeePages([page(2, ["A", "B", "C"])], "pages")).toThrow(expect.objectContaining({ code: "report_page_missing" }));
    expect(() => readShopeePages([page(1, ["A"]), page(3, ["B", "C"])], "pages")).toThrow(expect.objectContaining({ code: "report_page_missing" }));
    expect(() => readShopeePages([page(1, ["A"]), page(undefined, ["B", "C"])], "pages")).toThrow(expect.objectContaining({ code: "report_page_missing" }));
  });

  it("each file source reports the sha256 of the exact bytes it parsed", () => {
    for (const [name, report] of [
      ["shopee-export.csv", readShopeeFile({ path: fixture("shopee-export.csv") })],
      ["shopee-report.json", readShopeeFile({ path: fixture("shopee-report.json") })],
      ["accesstrade-transactions.json", readAccessTradeFile(fixture("accesstrade-transactions.json"))],
    ] as const) {
      expect(report.sha256).toBe(createHash("sha256").update(readFileSync(fixture(name))).digest("hex"));
    }
  });
});

describe("AccessTrade API: timeout and failures (fake fetch only)", () => {
  const since = parseInstant("2026-10-01T00:00:00.000Z");
  const until = parseInstant("2026-10-30T00:00:00.000Z");

  it("hands each request an abort signal with the configured timeout and fails on it as report_fetch_failed", async () => {
    let seen: AbortSignal | null = null;
    const get: HttpGet = (_url, _headers, signal) => {
      seen = signal;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
    };
    const error = await accessTradeApiSource({ apiKey: "k", since, until, get, timeoutMs: 20 }).read().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReportSourceError);
    expect(error).toMatchObject({ code: "report_fetch_failed" });
    expect((error as Error).cause).toBeInstanceOf(DOMException);
    expect((seen as AbortSignal | null)?.aborted).toBe(true);
    expect(ACCESSTRADE_TIMEOUT_MS).toBe(30_000);
  });

  it("wraps a network error and a body that is not JSON, keeping the cause and never the key", async () => {
    const down = new TypeError("fetch failed");
    const netError = await accessTradeApiSource({ apiKey: "secret-key", since, until, get: () => Promise.reject(down) }).read().catch((e: unknown) => e);
    expect(netError).toMatchObject({ code: "report_fetch_failed", cause: down });
    expect((netError as Error).message).not.toContain("secret-key");
    const bad = new SyntaxError("Unexpected token");
    const notJson = await accessTradeApiSource({ apiKey: "k", since, until, get: () => Promise.resolve({ status: 200, json: () => Promise.reject(bad) }) }).read().catch((e: unknown) => e);
    expect(notJson).toMatchObject({ code: "report_fetch_failed", cause: bad });
  });
});

describe("AC4: fingerprints", () => {
  it("the same input read twice gives identical fingerprints; a changed status changes it", () => {
    const a = readShopeeFile({ path: fixture("shopee-export.csv") }).rows.map((r) => r.fingerprint);
    const b = readShopeeFile({ path: fixture("shopee-export.csv") }).rows.map((r) => r.fingerprint);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
    const [row] = readShopeePages([conversion("F1")], "one");
    const [cancelled] = readShopeePages([{ ...conversion("F1"), orders: [{ ...conversion("F1").orders[0], order_status: "CANCELLED" }] }], "one");
    expect(row?.fingerprint).toBe(fingerprintRow(row as ReportRow));
    expect(cancelled?.fingerprint).not.toBe(row?.fingerprint);
  });
});

describe("AC5: the Shopee source makes no network call", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reads both file forms with fetch and sockets blocked", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.reject(new Error("network blocked")));
    const connectSpy = vi.spyOn(net.Socket.prototype, "connect").mockImplementation(() => {
      throw new Error("network blocked");
    });
    const csv = await shopeeFileSource({ path: fixture("shopee-export.csv") }).read();
    const json = await shopeeFileSource({ path: fixture("shopee-report.json") }).read();
    expect(csv.rows.length).toBeGreaterThan(0);
    expect(json.rows.length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(connectSpy).not.toHaveBeenCalled();
  });
});
