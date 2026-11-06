/**
 * One report page job (Story 5.9), as the live system read the report in production
 * (`report_reader.py` on main): the conversion report page is opened as it is (only when the tab is
 * not on it already), then the page itself asks for one page of its own list with the operator's
 * session (report-api-script.ts, D8, INV-10), and the job answers that list and total unchanged.
 * One page per job: the server asks for the next page as a new job (pages 1 to 20 of 50 at most),
 * so a link job can go first between two pages.
 *
 * The first version read the rendered table instead, through page parameters in the address and
 * React props; on the real page it never produced a page (production, 2026-11-02), so it was
 * replaced by the live system's proven read.
 *
 * A verification or login page, before or after the request, is answered as such (the server holds
 * or pauses the queue). A request that fails is answered with its reason code (`report_*`), never
 * the body. Every wait is in the service worker.
 */
import type { BridgeFailure, BridgeReportJob, BridgeReportValue } from "@cashback/contracts";

import { Blocked, blockedAnswer, throwIfBlocked, type PageDriver, type Wait } from "./bridge-tab";
import { readLocation } from "./page-scripts";
import { fetchReportList } from "./report-api-script";
import { AFFILIATE_ORIGIN, REPORT_API_PATH, REPORT_PAGE_SIZE, REPORT_PAGE_URL } from "./shopee-page";

export type ReportAnswer = { outcome: "value"; value: BridgeReportValue } | { outcome: "failed"; reason: BridgeFailure; blockedAt?: string };

/** The live reader let the report page settle this long after opening it, before the first request. */
export const REPORT_SETTLE_MS = 5_000;
/** How long the list request may take before the page counts as frozen; inside the server's 90 s job with the load and settle. */
export const REPORT_ANSWER_MS = 45_000;

const onReportPage = (href: string): boolean => href === REPORT_PAGE_URL || href.startsWith(`${REPORT_PAGE_URL}?`) || href.startsWith(`${REPORT_PAGE_URL}#`) || href.startsWith(`${REPORT_PAGE_URL}/`);

/** Looks at where the tab is; a verification or login page ends the job. */
async function checkSession(page: PageDriver): Promise<string> {
  const seen = await page.run(readLocation, null);
  throwIfBlocked(seen);
  return seen.href;
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export async function runReportJob(job: BridgeReportJob, page: PageDriver, wait: Wait): Promise<ReportAnswer> {
  if (job.purchaseTimeEnd < job.purchaseTimeStart) return { outcome: "failed", reason: "bad_job" };
  try {
    await page.prepare();
    if (!onReportPage(await page.href())) {
      await page.open(REPORT_PAGE_URL);
      await wait(REPORT_SETTLE_MS);
    }
    const href = await checkSession(page);
    if (!href.startsWith(`${AFFILIATE_ORIGIN}/`)) return { outcome: "failed", reason: "page_not_ready" };
    const answer = await page.run(fetchReportList, { path: REPORT_API_PATH, page: job.page, pageSize: REPORT_PAGE_SIZE, purchaseTimeStart: job.purchaseTimeStart, purchaseTimeEnd: job.purchaseTimeEnd }, REPORT_ANSWER_MS);
    if (!answer.ok) {
      // The request may have sent the session to verification or login: that is the answer then.
      await checkSession(page);
      return { outcome: "failed", reason: answer.why };
    }
    if (answer.list.length > REPORT_PAGE_SIZE || !answer.list.every(isRecord)) return { outcome: "failed", reason: "report_bad_answer" };
    return { outcome: "value", value: { page: job.page, total: answer.total, list: answer.list as BridgeReportValue["list"] } };
  } catch (error) {
    return error instanceof Blocked ? blockedAnswer(error) : { outcome: "failed", reason: "script_error" };
  }
}
