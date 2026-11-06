/**
 * Story 5.9, production 2026-11-02: the report page job reads the conversion report as the live
 * system did in production (`report_reader.py` on main): the report page is opened as it is, the
 * page asks for one page of its own list with the operator's session, and the job answers that
 * list and total unchanged. The page script runs here against a fake `fetch` (never the network);
 * the job runs on a fake page driver. No browser.
 */
import { bridgeReportValueSchema, type BridgeReportJob } from "@cashback/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PageDriver } from "../src/bridge-tab";
import { readLocation } from "../src/page-scripts";
import { fetchReportList, type ReportApiAnswer, type ReportApiInput } from "../src/report-api-script";
import { REPORT_ANSWER_MS, REPORT_SETTLE_MS, runReportJob } from "../src/report-job";
import { CUSTOM_LINK_URL, REPORT_API_PATH, REPORT_PAGE_URL } from "../src/shopee-page";
import { recordingWait } from "./fakes";

const JOB: BridgeReportJob = { ticket: "a".repeat(32), kind: "report", page: 2, purchaseTimeStart: 1_761_350_400, purchaseTimeEnd: 1_761_955_199, timeoutMs: 90_000 };
/** One conversion as the report list holds it (amounts x100,000), cut down. */
const CONVERSION = { checkout_id: 1, purchase_time: 1_761_620_400, utm_content: "C1-R1---", estimated_total_commission: 552_232_500, orders: [{ order_sn: "261028A", order_status: "PAID", items: [{ display_item_status: "Pending", actual_amount: 7_363_100_000 }] }] };

afterEach(() => vi.unstubAllGlobals());

interface FakeReportPage extends PageDriver {
  calls: string[];
  asked: ReportApiInput[];
  answerMs: (number | undefined)[];
  href_: string;
}

/** A tab that answers the location look and the list request; `after` is where the request sends the tab. */
function fakeReportPage(answer: ReportApiAnswer, at = REPORT_PAGE_URL, over: { after?: string; passwordBox?: boolean; stuckAt?: string } = {}): FakeReportPage {
  const page: FakeReportPage = {
    calls: [],
    asked: [],
    answerMs: [],
    href_: at,
    replaceTab: async () => null,
    replacements: () => 0,
    prepare: async () => void page.calls.push("prepare"),
    href: async () => page.href_,
    open: async (url) => {
      page.calls.push(`open ${url}`);
      page.href_ = over.stuckAt ?? url;
    },
    run: async <A, R>(func: (arg: A) => R, arg: A, answerMs?: number): Promise<R> => {
      if (func === (readLocation as unknown)) {
        page.calls.push("look");
        return { href: page.href_, passwordBox: over.passwordBox ?? false } as R;
      }
      if (func === (fetchReportList as unknown)) {
        page.calls.push("list");
        page.asked.push(arg as ReportApiInput);
        page.answerMs.push(answerMs);
        if (over.after !== undefined) page.href_ = over.after;
        return answer as R;
      }
      throw new Error("unknown page script");
    },
  };
  return page;
}

const listed = (list: unknown[], total: number | null = 120): ReportApiAnswer => ({ ok: true, list, total });

describe("production 2026-11-02: the report list page script mirrors the live extension's request", () => {
  const INPUT: ReportApiInput = { path: REPORT_API_PATH, page: 3, pageSize: 50, purchaseTimeStart: 100, purchaseTimeEnd: 200 };

  function stubFetch(respond: () => Promise<Response>): { urls: string[]; inits: (RequestInit | undefined)[] } {
    const seen = { urls: [] as string[], inits: [] as (RequestInit | undefined)[] };
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      seen.urls.push(url);
      seen.inits.push(init);
      return respond();
    });
    return seen;
  }
  const json = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("asks the page's own origin for one page of the list, a plain GET with the page's cookies and no header, and answers the list and total unchanged", async () => {
    const seen = stubFetch(json({ code: 0, data: { list: [CONVERSION], total: 120 } }));
    expect(await fetchReportList(INPUT)).toEqual({ ok: true, list: [CONVERSION], total: 120 });
    expect(seen.urls).toEqual(["/api/v3/report/list?page_size=50&page_num=3&purchase_time_s=100&purchase_time_e=200"]);
    expect(seen.inits).toEqual([{ credentials: "include" }]);
  });

  it("an empty answer is a page with no rows; a total that is not a count is null", async () => {
    stubFetch(json({ data: {} }));
    expect(await fetchReportList(INPUT)).toEqual({ ok: true, list: [], total: null });
    stubFetch(json({ data: { list: [], total: "12" } }));
    expect(await fetchReportList(INPUT)).toEqual({ ok: true, list: [], total: null });
  });

  it("every failure answers only a reason code, never the body", async () => {
    stubFetch(json({ msg: "forbidden for 0912345678" }, 403));
    expect(await fetchReportList(INPUT)).toEqual({ ok: false, why: "report_http_error" });
    stubFetch(json({ error: 90309999, msg: "session expired" }));
    expect(await fetchReportList(INPUT)).toEqual({ ok: false, why: "report_api_error" });
    stubFetch(async () => new Response("<html>login</html>", { status: 200 }));
    expect(await fetchReportList(INPUT)).toEqual({ ok: false, why: "report_not_json" });
    stubFetch(json({ data: { list: "none" } }));
    expect(await fetchReportList(INPUT)).toEqual({ ok: false, why: "report_bad_answer" });
    stubFetch(json(null));
    expect(await fetchReportList(INPUT)).toEqual({ ok: false, why: "report_bad_answer" });
    stubFetch(async () => Promise.reject(new TypeError("Failed to fetch")));
    expect(await fetchReportList(INPUT)).toEqual({ ok: false, why: "report_network_error" });
  });
});

describe("Story 5.9: one report page job", () => {
  it("opens the report page as it is (no parameters), lets it settle, then asks for the job's page and window, 50 rows a page", async () => {
    const page = fakeReportPage(listed([CONVERSION]), CUSTOM_LINK_URL);
    const wait = recordingWait();
    const answer = await runReportJob(JOB, page, wait);
    expect(answer).toEqual({ outcome: "value", value: { page: 2, total: 120, list: [CONVERSION] } });
    expect(bridgeReportValueSchema.safeParse(answer.outcome === "value" ? answer.value : null).success).toBe(true);
    expect(page.calls).toEqual(["prepare", `open ${REPORT_PAGE_URL}`, "look", "list"]);
    expect(wait.calls).toEqual([REPORT_SETTLE_MS]);
    expect(page.asked).toEqual([{ path: "/api/v3/report/list", page: 2, pageSize: 50, purchaseTimeStart: 1_761_350_400, purchaseTimeEnd: 1_761_955_199 }]);
    expect(page.answerMs).toEqual([REPORT_ANSWER_MS]);
  });

  it("a tab already on the report page is not reloaded between two pages", async () => {
    const page = fakeReportPage(listed([], 0));
    expect(await runReportJob({ ...JOB, page: 1 }, page, recordingWait())).toEqual({ outcome: "value", value: { page: 1, total: 0, list: [] } });
    expect(page.calls).toEqual(["prepare", "look", "list"]);
  });

  it("answers a verification page as captcha and the login page as login_redirect, before or after the request", async () => {
    const verify = "https://shopee.vn/verify/traffic/error";
    const stuck = fakeReportPage(listed([]), CUSTOM_LINK_URL, { stuckAt: verify });
    expect(await runReportJob(JOB, stuck, recordingWait())).toMatchObject({ outcome: "failed", reason: "captcha" });
    expect(stuck.asked).toEqual([]);
    const before = fakeReportPage(listed([]), REPORT_PAGE_URL, { passwordBox: true });
    expect(await runReportJob(JOB, before, recordingWait())).toMatchObject({ outcome: "failed", reason: "login_redirect" });
    expect(before.asked).toEqual([]);
    expect(await runReportJob(JOB, fakeReportPage({ ok: false, why: "report_http_error" }, REPORT_PAGE_URL, { after: verify }), recordingWait())).toMatchObject({ outcome: "failed", reason: "captcha" });
  });

  it("answers the request's own reason code, and a list it cannot pass on as report_bad_answer", async () => {
    for (const why of ["report_http_error", "report_api_error", "report_not_json", "report_network_error", "report_bad_answer"] as const) {
      expect(await runReportJob(JOB, fakeReportPage({ ok: false, why }), recordingWait())).toEqual({ outcome: "failed", reason: why });
    }
    expect(await runReportJob(JOB, fakeReportPage(listed(Array.from({ length: 51 }, () => CONVERSION))), recordingWait())).toEqual({ outcome: "failed", reason: "report_bad_answer" });
    expect(await runReportJob(JOB, fakeReportPage(listed([CONVERSION, "x"])), recordingWait())).toEqual({ outcome: "failed", reason: "report_bad_answer" });
    expect(await runReportJob({ ...JOB, purchaseTimeEnd: 1 }, fakeReportPage(listed([])), recordingWait())).toEqual({ outcome: "failed", reason: "bad_job" });
  });

  it("never asks from a page off the affiliate dashboard (the request is the page's own, on its origin)", async () => {
    const page = fakeReportPage(listed([]), CUSTOM_LINK_URL, { stuckAt: "https://shopee.vn/report/conversion_report" });
    expect(await runReportJob(JOB, page, recordingWait())).toEqual({ outcome: "failed", reason: "page_not_ready" });
    expect(page.asked).toEqual([]);
  });
});
