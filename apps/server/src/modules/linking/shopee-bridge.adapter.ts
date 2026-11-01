/**
 * The Shopee report source of production reconciliation (AD-8, AD-14, D8, D38, D43; Story 5.9): the
 * conversion report read page by page by the affiliate browser, one bridge job per page, never a
 * call from the server to Shopee. It sits behind the `WindowedReportSource` the hourly run and the
 * nightly sweep use; the saved-file source stays for rehearsals and dev.
 *
 * Between two pages the read yields to link work: while a link submission is due or out it waits
 * on the server (`yieldPollMs` steps, at most `yieldMaxMs`), and the bridge's own order of service
 * hands any link job out before the next page, so a customer's link waits for at most one page. A
 * held or paused Shopee queue (captcha, lost login, Story 5.5) is the same browser session, so no
 * page is asked for then; a page answered with a captcha or the login page holds or pauses the
 * queue exactly as a link submission does.
 *
 * A read is all or nothing (D43). Pages are read from 1 until one holds fewer than 50 rows or the
 * stated total is reached; a read that would need more than `maxPages` pages (20, as live) fails
 * with `report_page_cap`. A live report moves while it is read (a new purchase between two pages):
 * a conversion seen twice with the same content is kept once, and a total that changes, or is not
 * reached, reads again from page 1 once (`REPORT_READ_PASSES`); applying is idempotent, so a
 * second read costs nothing. The same conversion with different content on two pages fails the
 * read. The page must say it shows the page asked for, every row must look like a conversion, and
 * every purchase time must be readable and inside the window, or the read fails: a report page that
 * ignored the window is never applied. Rows go through the same
 * normaliser as the saved pages (status map, `fromNetworkUnits`), so a ShopeeFood order in the
 * report is read like any Shopee order (D60).
 */
import { bridgeReportValueSchema, SHOPEE_REPORT_PAGE_SIZE, type BridgeReportValue } from "@cashback/contracts";
import { instantFromMs, toMs, type Clock } from "@cashback/core";

import type { Ledger, LedgerDb } from "../../platform/db/ledger";
import type { AlertPort } from "../../platform/ports/alert.port";
import type { BridgePort, BridgeReportResult, ReportBridgeJob } from "../../platform/ports/bridge.port";
import { CAPTCHA_HOLD_MS, LINK_QUEUE_ALERTS } from "./domain/link-failure";
import { linkWorkDue } from "./link-lookup.command";
import { holdShopeeQueue, pauseShopeeQueue, shopeeQueueGate } from "./link-queue.command";
import { ReportSourceError, type ReportWindow, type SourcedReport, type WindowedReportSource } from "./report-source.port";
import { readShopeePages, SHOPEE_MAX_PAGES } from "./shopee-file.adapter";

export const REPORT_YIELD_POLL_MS = 1_000;
/** The longest a page waits for link work; after it the bridge's order of service still puts a link first. */
export const REPORT_YIELD_MAX_MS = 120_000;
export const SHOPEE_BRIDGE_REPORT = "bridge:conversion_report";
/** Reads from page 1 one read may take: the first, and one more when the report moved during it. */
export const REPORT_READ_PASSES = 2;

export interface ShopeeBridgeSourceDeps {
  readonly bridge: BridgePort;
  readonly ledger: Ledger;
  readonly clock: Clock;
  /** A server-side pause, cancelled by the signal. */
  readonly wait: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** The owner alerts, bound to one transaction (captcha, lost login). */
  readonly alerts: (db: LedgerDb) => AlertPort;
  readonly maxPages?: number;
  readonly yieldPollMs?: number;
  readonly yieldMaxMs?: number;
}

const fail = (code: "report_fetch_failed" | "report_source_unavailable" | "report_page_cap", message: string): never => {
  throw new ReportSourceError(code, message);
};

/** The window as the report page takes it: whole seconds, both ends included. */
export function reportSeconds(window: ReportWindow): { purchaseTimeStart: number; purchaseTimeEnd: number } {
  return { purchaseTimeStart: Math.floor(toMs(window.since) / 1000), purchaseTimeEnd: Math.ceil(toMs(window.until) / 1000) - 1 };
}

/** Waits while link work is due, at most `yieldMaxMs`; refuses while the Shopee queue is held or paused. */
async function yieldToLinks(deps: ShopeeBridgeSourceDeps, signal: AbortSignal | undefined): Promise<void> {
  const step = deps.yieldPollMs ?? REPORT_YIELD_POLL_MS;
  for (let waited = 0; ; waited += step) {
    if (signal?.aborted === true) fail("report_source_unavailable", "the read was stopped");
    const now = deps.clock.now();
    const gate = shopeeQueueGate(deps.ledger.db, now);
    if (gate !== "open") fail("report_source_unavailable", `the Shopee queue is ${gate}; no report page is read`);
    if (!linkWorkDue(deps.ledger.db, now) || waited >= (deps.yieldMaxMs ?? REPORT_YIELD_MAX_MS)) return;
    await deps.wait(step, signal);
  }
}

/** A failed page: a captcha holds the queue, the login page pauses it (Story 5.5); the read fails either way. */
function pageFailed(deps: ShopeeBridgeSourceDeps, page: number, reason: string): never {
  const at = deps.clock.now();
  if (reason === "captcha" || reason === "login_redirect") {
    deps.ledger.tx((db) => {
      if (reason === "captcha") {
        holdShopeeQueue(db, "captcha", instantFromMs(toMs(at) + CAPTCHA_HOLD_MS));
        deps.alerts(db).alert(LINK_QUEUE_ALERTS.captcha.kind, LINK_QUEUE_ALERTS.captcha.severity);
      } else if (pauseShopeeQueue(db, "login_redirect", at)) {
        deps.alerts(db).alert(LINK_QUEUE_ALERTS.login_redirect.kind, LINK_QUEUE_ALERTS.login_redirect.severity);
      }
    });
  }
  return fail("report_fetch_failed", `report page ${page}: the browser answered ${reason}`);
}

/** The page's rows as the contract allows them, the page it says it shows, and rows that look like conversions. */
function pageValue(deps: ShopeeBridgeSourceDeps, page: number, answer: BridgeReportResult): BridgeReportValue {
  if (answer.outcome === "unavailable") return fail("report_source_unavailable", `report page ${page}: ${answer.reason}`);
  if (answer.outcome === "failed") return pageFailed(deps, page, answer.reason);
  const value = bridgeReportValueSchema.safeParse(answer.value);
  if (!value.success) return fail("report_fetch_failed", `report page ${page}: the answer is not a report page`);
  if (value.data.page !== page) return fail("report_fetch_failed", `report page ${page}: the page shows page ${value.data.page}`);
  if (value.data.list.some((row) => !Array.isArray(row["orders"]))) return fail("report_fetch_failed", `report page ${page}: a row is not a conversion`);
  return value.data;
}

async function ask(deps: ShopeeBridgeSourceDeps, job: ReportBridgeJob, signal: AbortSignal): Promise<BridgeReportResult> {
  const read = deps.bridge.readReportPage;
  if (read === undefined) return fail("report_source_unavailable", "this bridge reads no report pages");
  try {
    return await read.call(deps.bridge, job, signal);
  } catch (error) {
    return fail(signal.aborted ? "report_source_unavailable" : "report_fetch_failed", `report page ${job.page}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** A conversion's identity across pages: its checkout id, else its orders' ids. */
function conversionId(raw: Record<string, unknown>): string {
  const checkout = raw["checkout_id"];
  if ((typeof checkout === "string" && checkout !== "") || typeof checkout === "number") return String(checkout);
  const orders = Array.isArray(raw["orders"]) ? raw["orders"] : [];
  return orders.map((o) => (o !== null && typeof o === "object" ? String((o as Record<string, unknown>)["order_sn"] ?? "") : "")).join(",");
}

type Pass = { readonly kind: "read"; readonly list: Conversion[] } | { readonly kind: "moved" };
type Conversion = BridgeReportValue["list"][number];

/**
 * One pass over the pages from page 1. A live report moves while it is read: a purchase that lands
 * between two pages pushes a row of the last page onto the next one. A conversion seen again with
 * the same content is kept once; seen again with other content, the read fails. A total that
 * changes between pages ends the pass as `moved`, so the caller reads again from page 1.
 */
async function readPass(deps: ShopeeBridgeSourceDeps, window: ReportWindow, signal: AbortSignal): Promise<Pass> {
  const seconds = reportSeconds(window);
  const maxPages = deps.maxPages ?? SHOPEE_MAX_PAGES;
  const seen = new Map<string, string>();
  const list: Conversion[] = [];
  let firstTotal: number | null | undefined;
  for (let page = 1; ; page++) {
    await yieldToLinks(deps, signal);
    const value = pageValue(deps, page, await ask(deps, { page, ...seconds }, signal));
    // A page that states no total (an empty page past the last one shows no pager) says nothing about a move.
    if (firstTotal === undefined || firstTotal === null) firstTotal = value.total;
    else if (value.total !== null && value.total !== firstTotal) return { kind: "moved" };
    for (const raw of value.list) {
      const id = conversionId(raw);
      const content = JSON.stringify(raw);
      const before = id === "" ? undefined : seen.get(id);
      if (before === content) continue;
      if (before !== undefined) fail("report_fetch_failed", `conversion ${id} shows different content on two pages of one read`);
      if (id !== "") seen.set(id, content);
      list.push(raw);
    }
    const total = firstTotal ?? null;
    const more = value.list.length >= SHOPEE_REPORT_PAGE_SIZE && (total === null || list.length < total);
    if (!more) {
      if (total !== null && list.length < total) return { kind: "moved" };
      return { kind: "read", list };
    }
    if (page >= maxPages) fail("report_page_cap", `${maxPages} full pages of the report and more to come; the window holds too many conversions`);
  }
}

/** Every conversion of the window: one pass, or a second from page 1 when the report moved during the first. */
async function readConversions(deps: ShopeeBridgeSourceDeps, window: ReportWindow, signal: AbortSignal): Promise<Conversion[]> {
  for (let pass = 1; pass <= REPORT_READ_PASSES; pass++) {
    const read = await readPass(deps, window, signal);
    if (read.kind === "read") return read.list;
  }
  return fail("report_fetch_failed", `the report kept changing during ${REPORT_READ_PASSES} reads; the next run reads it again`);
}

export function shopeeBridgeSource(deps: ShopeeBridgeSourceDeps): WindowedReportSource {
  return {
    network: "shopee",
    async read(window, signal) {
      const stop = signal ?? new AbortController().signal;
      const rows = readShopeePages(await readConversions(deps, window, stop), SHOPEE_BRIDGE_REPORT);
      const since = toMs(window.since);
      const until = Math.ceil(toMs(window.until) / 1000) * 1000;
      // A row without a readable purchase time cannot be shown to be inside the window: the page may have ignored it.
      const outside = rows.filter((r) => r.purchasedAt === null || toMs(r.purchasedAt) < since || toMs(r.purchasedAt) >= until);
      if (outside.length > 0) fail("report_fetch_failed", `${outside.length} rows were purchased outside the window or at no readable time; the report page did not apply it`);
      return { network: "shopee", source: SHOPEE_BRIDGE_REPORT, rows, skippedLines: 0, sha256: null } satisfies SourcedReport;
    },
  };
}
