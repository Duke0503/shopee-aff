/**
 * The Shopee report source of the shadow run (decision H10): a file the operator saved, so no
 * bridge job and no Shopee host is ever reached (D8). Two forms are read:
 *
 * - `.csv`: the conversion report export, as the live `report_importer.py` reads it, with the
 *   operator's `report_mapping.json` when given, or the guessed mapping (domain/shopee-export.ts).
 * - `.json`: the report page's `/api/v3/report/list` answers as the live `report_reader.py`
 *   receives them: one body `{ data: { list, total } }`, the bridge result `{ list, total }`,
 *   an array of such pages, or a bare array of conversions.
 *
 * Saved pages that hold fewer conversions than their `total`, or that stop at the live reader's
 * page cap (20 full pages of 50), fail with `report_page_cap` and yield nothing. A page saved
 * twice (the same page number, or a conversion already read) fails with `report_duplicate_page`,
 * and numbered pages that do not run from 1 without a gap with `report_page_missing`. The file is
 * read once; its checksum is of the bytes parsed.
 */
import { basename, extname } from "node:path";

import { asArray, asId, asObject, readPurchaseTime } from "./domain/report-row";
import { readShopeeExport, shopeeExportMapping, ShopeeExportMappingError, type ShopeeExportMapping } from "./domain/shopee-export";
import { readShopeeConversion } from "./domain/shopee-report";
import { assertComplete, cachedFileReport, readReportFile, ReportSourceError, sourced, withinWindow, type ReportSource, type SourcedReport, type SourcedRow, type WindowedReportSource } from "./report-source.port";

/** report_reader.py PAGE_SIZE and MAX_PAGES. */
export const SHOPEE_PAGE_SIZE = 50;
export const SHOPEE_MAX_PAGES = 20;

export interface ShopeeFileOptions {
  path: string;
  /** A report_mapping.json for a CSV export; the mapping is guessed from the headers without it. */
  mappingPath?: string;
}

function parseJson(text: string, path: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ReportSourceError("report_file_unreadable", `not JSON: ${path}`);
  }
}

interface Page {
  list: unknown[];
  total: number | null;
  /** The page number the answer was saved with (`page_num` or `page`), when it says. */
  pageNum: number | null;
}

const wholeNumber = (value: unknown): number | null => (typeof value === "number" && Number.isSafeInteger(value) ? value : null);

const isPage = (value: unknown): boolean => {
  const o = asObject(value);
  return Array.isArray(o["list"]) || Array.isArray(asObject(o["data"])["list"]);
};

function pageOf(value: unknown): Page {
  const o = asObject(value);
  const body = Array.isArray(o["list"]) ? o : asObject(o["data"]);
  const pageNum = wholeNumber(o["page_num"] ?? o["page"] ?? body["page_num"] ?? body["page"]);
  return { list: asArray(body["list"]), total: wholeNumber(body["total"]), pageNum };
}

/** Saved pages are each saved once and run from page 1 without a gap. */
function assertPagesOnce(pages: readonly Page[], what: string): void {
  const numbers = pages.map((p) => p.pageNum);
  if (numbers.some((n) => n !== null)) {
    if (numbers.some((n) => n === null)) throw new ReportSourceError("report_page_missing", `${what}: some saved pages carry no page number`);
    const sorted = [...(numbers as number[])].sort((a, b) => a - b);
    if (new Set(sorted).size !== sorted.length) throw new ReportSourceError("report_duplicate_page", `${what}: a page number is saved twice`);
    if (sorted.some((n, i) => n !== i + 1)) throw new ReportSourceError("report_page_missing", `${what}: pages must run from 1 without a gap, found ${sorted.join(", ")}`);
  }
  const seen = new Set<string>();
  for (const raw of pages.flatMap((p) => p.list)) {
    const c = asObject(raw);
    const id = asId(c["checkout_id"]) || asArray(c["orders"]).map((o) => asId(asObject(o)["order_sn"])).join(",");
    if (id === "") continue;
    if (seen.has(id)) throw new ReportSourceError("report_duplicate_page", `${what}: conversion ${id} is saved twice; a page was saved twice`);
    seen.add(id);
  }
}

/** The saved answers as pages; a bare array of conversions is one page without a total. */
export function shopeePages(json: unknown): Page[] {
  if (Array.isArray(json)) return json.length > 0 && json.every(isPage) ? json.map(pageOf) : [{ list: json, total: null, pageNum: null }];
  if (isPage(json)) return [pageOf(json)];
  throw new ReportSourceError("report_file_unreadable", "a Shopee report file holds report pages or an array of conversions");
}

export function readShopeePages(json: unknown, what: string): SourcedRow[] {
  const pages = shopeePages(json);
  assertPagesOnce(pages, what);
  const conversions = pages.flatMap((p) => p.list);
  const totals = pages.map((p) => p.total).filter((t): t is number => t !== null);
  assertComplete(conversions.length, totals.length > 0 ? Math.max(...totals) : null, what);
  const last = pages.at(-1);
  if (totals.length === 0 && pages.length >= SHOPEE_MAX_PAGES && (last?.list.length ?? 0) >= SHOPEE_PAGE_SIZE) {
    throw new ReportSourceError("report_page_cap", `${what}: ${SHOPEE_MAX_PAGES} full pages, the live reader's cap; narrow the date range`);
  }
  return conversions.flatMap((raw) => {
    const purchasedAt = readPurchaseTime(asObject(raw)["purchase_time"]);
    return readShopeeConversion(raw).map((row) => sourced(row, purchasedAt));
  });
}

function readMapping(path: string): ShopeeExportMapping {
  return shopeeExportMapping(asObject(parseJson(readReportFile(path).text, path)));
}

function readCsv(text: string, options: ShopeeFileOptions): { rows: SourcedRow[]; skippedLines: number } {
  try {
    const exported = readShopeeExport(text, options.mappingPath === undefined ? undefined : readMapping(options.mappingPath));
    return { rows: exported.rows.map((r) => sourced(r.row, r.purchasedAt)), skippedLines: exported.skippedLines };
  } catch (error) {
    if (error instanceof ShopeeExportMappingError) throw new ReportSourceError("report_mapping_incomplete", error.message);
    throw error;
  }
}

/** Reads the whole file synchronously; a CSV unless the extension is `.json`. */
export function readShopeeFile(options: ShopeeFileOptions): SourcedReport {
  const { text, sha256 } = readReportFile(options.path);
  const source = `file:${basename(options.path)}`;
  if (extname(options.path).toLowerCase() === ".json") return { network: "shopee", source, rows: readShopeePages(parseJson(text, options.path), source), skippedLines: 0, sha256 };
  return { network: "shopee", source, ...readCsv(text, options), sha256 };
}

export function shopeeFileSource(options: ShopeeFileOptions): ReportSource {
  return { network: "shopee", read: () => Promise.resolve().then(() => readShopeeFile(options)) };
}

/** A saved report read for reconciliation (until the bridge of Story 5.9): parsed once while unchanged, cut to each window. */
export function shopeeFileWindowSource(options: ShopeeFileOptions): WindowedReportSource {
  const report = cachedFileReport(options.path, () => readShopeeFile(options));
  return { network: "shopee", read: (window) => Promise.resolve().then(() => withinWindow(report(), window)) };
}
