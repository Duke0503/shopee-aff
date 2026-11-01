/**
 * One report page job (Story 5.9; the live `report_reader.py` read as reference, without its API
 * call, D8, INV-10): the conversion report page opened at the job's page and purchase-time window,
 * looked at until its table has loaded (or the wait ends), and answered with the records the table
 * rendered, the page the pager marks as shown and the total it states. One page per job: the
 * server asks for the next page as a new job, so a link job can go first between two pages.
 *
 * A verification or login page is answered as such (the server holds or pauses the queue). An
 * empty table is a page with no rows, whatever its number. A table that never loads is
 * `page_not_ready`; rows whose records cannot be read are `script_error`. Every
 * wait is in the service worker; the page script looks once and returns.
 */
import type { BridgeFailure, BridgeReportJob, BridgeReportValue } from "@cashback/contracts";

import type { PageDriver, Wait } from "./bridge-tab";
import { Blocked, lookUntil } from "./lookup-job";
import { readReportTable, type ReportLook, type ReportTableInput } from "./page-scripts";
import { REPORT_ACTIVE_PAGE, REPORT_EMPTY, REPORT_LOADING, REPORT_PAGE_SIZE, REPORT_PAGER, REPORT_ROW, reportPageUrl } from "./shopee-page";

export type ReportAnswer = { outcome: "value"; value: BridgeReportValue } | { outcome: "failed"; reason: BridgeFailure };

const TABLE: ReportTableInput = { row: REPORT_ROW, empty: REPORT_EMPTY, pager: REPORT_PAGER, activePage: REPORT_ACTIVE_PAGE, loading: REPORT_LOADING, maxRows: REPORT_PAGE_SIZE };

/**
 * The page the table shows: the pager's mark; page 1 when a single page shows no pager; and the
 * page asked for when the table is empty with no pager, which is the report's "no more rows" past
 * its last page (review item 6). Rows with no pager past page 1 cannot be placed.
 */
const shownPage = (look: ReportLook, asked: number): number | null => look.shownPage ?? (asked === 1 || look.state === "empty" ? asked : null);

export async function runReportJob(job: BridgeReportJob, page: PageDriver, wait: Wait): Promise<ReportAnswer> {
  if (job.purchaseTimeEnd < job.purchaseTimeStart) return { outcome: "failed", reason: "bad_job" };
  try {
    await page.prepare();
    await page.open(reportPageUrl(job));
    const look = await lookUntil(() => page.run(readReportTable, TABLE), (l) => l.state !== "waiting", wait);
    if (look.state === "waiting") return { outcome: "failed", reason: "page_not_ready" };
    if (look.state === "unreadable") return { outcome: "failed", reason: "script_error" };
    const shown = shownPage(look, job.page);
    if (shown === null) return { outcome: "failed", reason: "page_not_ready" };
    const list = look.state === "rows" ? (look.records as BridgeReportValue["list"]) : [];
    return { outcome: "value", value: { page: shown, total: look.total ?? (look.state === "empty" && job.page === 1 ? 0 : null), list } };
  } catch (error) {
    return { outcome: "failed", reason: error instanceof Blocked ? error.reason : "script_error" };
  }
}
