/**
 * AccessTrade's `/v1/transactions`, read live and read-only, as the live
 * `fetch_accesstrade_transactions` reads it: `limit` 100 per page, at most 10 pages, a window of
 * at most 30 days (a 60-day window answered 500). The HTTP call goes through the `HttpGet` port
 * so tests hand in a fake and never reach the network. Each page has a timeout (30 s by
 * default); a network error, a timeout or a body that is not JSON is `report_fetch_failed` with
 * its cause. Where the live code stopped silently at
 * its page cap, this source fails with `report_page_cap` and yields no partial set (D43). No
 * ledger transaction may be open while it runs (code.md §5): it is read before reconciliation.
 */
import { toMs, type Instant } from "@cashback/core";

import { readAccessTradePages, type AccessTradePage } from "./accesstrade-file.adapter";
import { ReportSourceError, type ReportSource, type SourcedReport, type WindowedReportSource } from "./report-source.port";

export const ACCESSTRADE_PAGE_LIMIT = 100;
export const ACCESSTRADE_MAX_PAGES = 10;
export const ACCESSTRADE_MAX_WINDOW_DAYS = 30;
export const ACCESSTRADE_TIMEOUT_MS = 30_000;

export interface HttpAnswer {
  readonly status: number;
  json(): Promise<unknown>;
}

/** One GET; `signal` aborts it when the source's timeout passes. */
export type HttpGet = (url: string, headers: Readonly<Record<string, string>>, signal: AbortSignal) => Promise<HttpAnswer>;

export const fetchGet: HttpGet = (url, headers, signal) => fetch(url, { headers, signal });

export interface AccessTradeApiOptions {
  apiKey: string;
  baseUrl?: string;
  since: Instant;
  until: Instant;
  get?: HttpGet;
  maxPages?: number;
  /** Per page, request and body together; 30 s by default. */
  timeoutMs?: number;
  /** Aborts every page read, with the timeout; the scheduler's stop signal (AD-13). */
  signal?: AbortSignal;
}

const DAY_MS = 86_400_000;
const apiTime = (instant: Instant): string => instant.replace(/\.\d{3}Z$/, "Z");

function checkWindow(options: AccessTradeApiOptions): void {
  const days = (toMs(options.until) - toMs(options.since)) / DAY_MS;
  if (!(days > 0) || days > ACCESSTRADE_MAX_WINDOW_DAYS) {
    throw new ReportSourceError("report_window_too_long", `the AccessTrade window must be 1 to ${ACCESSTRADE_MAX_WINDOW_DAYS} days`);
  }
}

async function getPage(options: AccessTradeApiOptions, page: number): Promise<AccessTradePage> {
  const base = (options.baseUrl ?? "https://api.accesstrade.vn").replace(/\/+$/, "");
  const query = new URLSearchParams({ since: apiTime(options.since), until: apiTime(options.until), limit: String(ACCESSTRADE_PAGE_LIMIT), page: String(page) });
  const auth = options.apiKey.startsWith("Token ") ? options.apiKey : `Token ${options.apiKey}`;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? ACCESSTRADE_TIMEOUT_MS);
  const signal = options.signal === undefined ? timeout : AbortSignal.any([timeout, options.signal]);
  let body: unknown;
  try {
    const answer = await (options.get ?? fetchGet)(`${base}/v1/transactions?${query.toString()}`, { Authorization: auth }, signal);
    if (answer.status !== 200) throw new ReportSourceError("report_fetch_failed", `AccessTrade answered ${answer.status} on page ${page}`);
    body = await answer.json();
  } catch (error) {
    if (error instanceof ReportSourceError) throw error;
    // A network error, a timeout or a body that is not JSON: the cause is kept, the key never shown.
    throw new ReportSourceError("report_fetch_failed", `AccessTrade page ${page} failed: ${error instanceof Error ? error.name : "error"}`, { cause: error });
  }
  if (Array.isArray(body)) return { lines: body, total: null };
  if (typeof body !== "object" || body === null) throw new ReportSourceError("report_fetch_failed", `AccessTrade page ${page} is not a transactions answer`);
  const answerBody = body as Record<string, unknown>;
  const total = answerBody["total"] === undefined || answerBody["total"] === null ? Number.NaN : Number(answerBody["total"]);
  return { lines: Array.isArray(answerBody["data"]) ? answerBody["data"] : [], total: Number.isSafeInteger(total) ? total : null };
}

export async function readAccessTradeApi(options: AccessTradeApiOptions): Promise<SourcedReport> {
  checkWindow(options);
  const pages: AccessTradePage[] = [];
  const maxPages = options.maxPages ?? ACCESSTRADE_MAX_PAGES;
  for (let page = 1; page <= maxPages; page++) {
    const got = await getPage(options, page);
    pages.push(got);
    const read = pages.reduce((n, p) => n + p.lines.length, 0);
    // Without a total, a full page may have more behind it.
    const done = got.total === null ? got.lines.length < ACCESSTRADE_PAGE_LIMIT : read >= got.total;
    if (got.lines.length === 0 || done) {
      return { network: "accesstrade", source: "api:/v1/transactions", rows: readAccessTradePages(pages, "AccessTrade API"), skippedLines: 0, sha256: null };
    }
  }
  throw new ReportSourceError("report_page_cap", `AccessTrade: ${maxPages} pages read and more remain; narrow the window`);
}

export function accessTradeApiSource(options: AccessTradeApiOptions): ReportSource {
  return { network: "accesstrade", read: () => readAccessTradeApi(options) };
}

/** The reconciliation source (Stories 3.7, 3.8): the API asked for each run's window. */
export function accessTradeWindowSource(options: Omit<AccessTradeApiOptions, "since" | "until">): WindowedReportSource {
  return { network: "accesstrade", read: (window, signal) => readAccessTradeApi({ ...options, since: window.since, until: window.until, ...(signal === undefined ? {} : { signal }) }) };
}
