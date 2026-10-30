/**
 * The AccessTrade report source of the shadow run: a saved `/v1/transactions` answer in the
 * shape the live `accesstrade_reconciler.py` consumes (`fetch_accesstrade_transactions`): one
 * body `{ data: [lines], total }`, an array of such pages, or a bare array of lines. The lines
 * are read by domain/accesstrade-report.ts; each transaction's purchase time is its first
 * line's `transaction_time`. The file is read once and its checksum is of the bytes parsed.
 * Pages holding fewer lines than their `total` fail with
 * `report_page_cap` and yield nothing. The API itself is read by accesstrade-api.adapter.ts.
 */
import { basename } from "node:path";
import type { Instant } from "@cashback/core";

import { readAccessTradeTransactions } from "./domain/accesstrade-report";
import { asArray, asId, asObject, readPurchaseTime } from "./domain/report-row";
import { assertComplete, readReportFile, ReportSourceError, sourced, type ReportSource, type SourcedReport, type SourcedRow } from "./report-source.port";

export interface AccessTradePage {
  lines: unknown[];
  total: number | null;
}

const isBody = (value: unknown): boolean => Array.isArray(asObject(value)["data"]);

function pageOf(value: unknown): AccessTradePage {
  const body = asObject(value);
  const total = body["total"];
  const n = typeof total === "number" ? total : typeof total === "string" && /^\d+$/.test(total.trim()) ? Number(total) : null;
  return { lines: asArray(body["data"]), total: n !== null && Number.isSafeInteger(n) ? n : null };
}

export function accessTradePages(json: unknown): AccessTradePage[] {
  if (Array.isArray(json)) return json.length > 0 && json.every(isBody) ? json.map(pageOf) : [{ lines: json, total: null }];
  if (isBody(json)) return [pageOf(json)];
  throw new ReportSourceError("report_file_unreadable", "an AccessTrade report file holds /v1/transactions answers or an array of lines");
}

/** Every line of complete pages as sourced rows, one per transaction. */
export function readAccessTradePages(pages: readonly AccessTradePage[], what: string): SourcedRow[] {
  const lines = pages.flatMap((p) => p.lines);
  const totals = pages.map((p) => p.total).filter((t): t is number => t !== null);
  assertComplete(lines.length, totals.length > 0 ? Math.max(...totals) : null, what);
  const purchased = new Map<string, Instant | null>();
  for (const raw of lines) {
    const line = asObject(raw);
    const id = asId(line["transaction_id"]) || asId(line["order_id"]);
    if (id !== "" && !purchased.has(id)) purchased.set(id, readPurchaseTime(line["transaction_time"]));
  }
  return readAccessTradeTransactions(lines).map((row) => sourced(row, purchased.get(row.orderId) ?? null));
}

export function readAccessTradeFile(path: string): SourcedReport {
  const { text, sha256 } = readReportFile(path);
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch (error) {
    throw new ReportSourceError("report_file_unreadable", `not JSON: ${path}`, { cause: error });
  }
  const source = `file:${basename(path)}`;
  return { network: "accesstrade", source, rows: readAccessTradePages(accessTradePages(json), source), skippedLines: 0, sha256 };
}

export function accessTradeFileSource(path: string): ReportSource {
  return { network: "accesstrade", read: () => Promise.resolve().then(() => readAccessTradeFile(path)) };
}
