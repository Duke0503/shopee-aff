// @vitest-environment jsdom
/**
 * Story 5.9: the report page job opens one page of one window on the conversion report page,
 * waits in the worker until the table has loaded, and answers the records the table rendered.
 * The page script is run on a copy of the antd table structure (jsdom, React props stood in for
 * by a fiber-shaped property); the job runs on a fake page driver. No network, no browser.
 */
import { bridgeReportValueSchema, type BridgeReportJob } from "@cashback/contracts";
import { describe, expect, it } from "vitest";

import type { PageDriver } from "../src/bridge-tab";
import { readReportTable, type ReportLook, type ReportTableInput } from "../src/page-scripts";
import { runReportJob } from "../src/report-job";
import { REPORT_ACTIVE_PAGE, REPORT_EMPTY, REPORT_LOADING, REPORT_PAGE_URL, REPORT_PAGER, REPORT_ROW } from "../src/shopee-page";

const TABLE: ReportTableInput = { row: REPORT_ROW, empty: REPORT_EMPTY, pager: REPORT_PAGER, activePage: REPORT_ACTIVE_PAGE, loading: REPORT_LOADING, maxRows: 50 };
const JOB: BridgeReportJob = { ticket: "a".repeat(32), kind: "report", page: 2, purchaseTimeStart: 1_761_350_400, purchaseTimeEnd: 1_761_955_199, timeoutMs: 90_000 };
const CONVERSION = { checkout_id: "1", purchase_time: 1_761_620_400, utm_content: "C1-R1---", orders: [{ order_sn: "261028A", order_status: "PAID", items: [] }] };

/** Gives an element the React fiber shape the page script walks: props on a parent fiber. */
function withProps(el: Element, props: Record<string, unknown>): void {
  (el as unknown as Record<string, unknown>)["__reactFiber$test"] = { memoizedProps: { className: "x" }, return: { memoizedProps: props, return: null } };
}

function fakeReportPage(looks: ReportLook[]): PageDriver & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    prepare: async () => void calls.push("prepare"),
    href: async () => REPORT_PAGE_URL,
    open: async (url) => void calls.push(`open ${url}`),
    run: async <A, R>(_func: (arg: A) => R): Promise<R> => {
      calls.push("look");
      return (looks.length > 1 ? looks.shift() : looks[0]) as R;
    },
  };
}

const look = (over: Partial<ReportLook> & Pick<ReportLook, "state">): ReportLook => ({ href: REPORT_PAGE_URL, passwordBox: false, shownPage: 2, total: 120, ...over }) as ReportLook;
const noWait = async () => undefined;

describe("Story 5.9: the report table page script", () => {
  it("reads each row's rendered record, the page the pager marks and the pager's total; it extracts nothing", () => {
    document.body.innerHTML = `<table><tbody><tr data-row-key="1"><td>a</td></tr><tr data-row-key="2"><td>b</td></tr></tbody></table>
      <ul class="ant-pagination"><li class="ant-pagination-item">1</li><li class="ant-pagination-item ant-pagination-item-active">2</li></ul>`;
    const rows = document.querySelectorAll(REPORT_ROW);
    withProps(rows[0] as Element, { record: CONVERSION });
    withProps(rows[1] as Element, { record: { ...CONVERSION, checkout_id: "2" } });
    withProps(document.querySelector(REPORT_PAGER) as Element, { total: 120 });
    const seen = readReportTable(TABLE);
    expect(seen).toMatchObject({ state: "rows", shownPage: 2, total: 120, passwordBox: false });
    expect(seen.state === "rows" ? seen.records : null).toEqual([CONVERSION, { ...CONVERSION, checkout_id: "2" }]);
  });

  it("is waiting while the table loads, empty on the empty state, and unreadable when a row has no record", () => {
    document.body.innerHTML = '<div class="ant-spin-spinning"></div><table><tbody><tr data-row-key="1"></tr></tbody></table>';
    expect(readReportTable(TABLE).state).toBe("waiting");
    document.body.innerHTML = "<div>loading</div>";
    expect(readReportTable(TABLE).state).toBe("waiting");
    document.body.innerHTML = '<div class="ant-empty">No data</div>';
    expect(readReportTable(TABLE)).toMatchObject({ state: "empty", shownPage: null, total: null });
    document.body.innerHTML = '<table><tbody><tr data-row-key="1"></tr></tbody></table>';
    expect(readReportTable(TABLE).state).toBe("unreadable");
  });
});

describe("Story 5.9: one report page job", () => {
  it("opens the job's page and window on the report page, looks until the table loads, and answers a contract value", async () => {
    const page = fakeReportPage([look({ state: "waiting" }), look({ state: "rows", records: [CONVERSION] })]);
    const answer = await runReportJob(JOB, page, noWait);
    expect(answer).toEqual({ outcome: "value", value: { page: 2, total: 120, list: [CONVERSION] } });
    expect(bridgeReportValueSchema.safeParse(answer.outcome === "value" ? answer.value : null).success).toBe(true);
    expect(page.calls).toEqual(["prepare", `open ${REPORT_PAGE_URL}?page_num=2&page_size=50&purchase_time_s=1761350400&purchase_time_e=1761955199`, "look", "look"]);
  });

  it("answers the page the pager shows (the server refuses a mismatch), and an empty first page as no rows", async () => {
    expect(await runReportJob(JOB, fakeReportPage([look({ state: "rows", shownPage: 1, records: [] })]), noWait)).toMatchObject({ value: { page: 1 } });
    expect(await runReportJob({ ...JOB, page: 1 }, fakeReportPage([look({ state: "empty", shownPage: null, total: null })]), noWait)).toEqual({ outcome: "value", value: { page: 1, total: 0, list: [] } });
    expect(await runReportJob(JOB, fakeReportPage([look({ state: "rows", shownPage: null, records: [CONVERSION] })]), noWait)).toEqual({ outcome: "failed", reason: "page_not_ready" });
  });

  it("review 6: an empty table with no pager past page 1 is a valid 'no more rows' answer, never page_not_ready", async () => {
    expect(await runReportJob(JOB, fakeReportPage([look({ state: "empty", shownPage: null, total: null })]), noWait)).toEqual({ outcome: "value", value: { page: 2, total: null, list: [] } });
  });

  it("answers a verification page as captcha, the login page as login_redirect, a table that never loads as page_not_ready", async () => {
    expect(await runReportJob(JOB, fakeReportPage([look({ state: "waiting", href: "https://shopee.vn/verify/traffic/error" })]), noWait)).toEqual({ outcome: "failed", reason: "captcha" });
    expect(await runReportJob(JOB, fakeReportPage([look({ state: "waiting", passwordBox: true })]), noWait)).toEqual({ outcome: "failed", reason: "login_redirect" });
    expect(await runReportJob(JOB, fakeReportPage([look({ state: "waiting" })]), noWait)).toEqual({ outcome: "failed", reason: "page_not_ready" });
    expect(await runReportJob(JOB, fakeReportPage([look({ state: "unreadable" })]), noWait)).toEqual({ outcome: "failed", reason: "script_error" });
  });
});
