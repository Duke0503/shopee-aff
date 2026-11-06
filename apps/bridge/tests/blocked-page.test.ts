/**
 * D69: an answer to a captcha or a login page names the page, origin and path only, through every
 * job kind, a fresh tab and a frozen one. Fake page and fake Chrome; no browser, no network.
 */
import { bridgeResultSchema, BRIDGE_BLOCKED_AT_MAX_LENGTH, type BridgeJob } from "@cashback/contracts";
import { instantFromMs } from "@cashback/core";
import { describe, expect, it } from "vitest";

import { jobWorker } from "../src/bridge-loop";
import { chromePageDriver } from "../src/bridge-tab";
import { readPage } from "../src/page-scripts";
import { fetchReportList } from "../src/report-api-script";
import { pageAddress, REPORT_PAGE_URL } from "../src/shopee-page";
import { fakeChrome, fakePage, recordingWait } from "./fakes";

const VERIFY = "https://affiliate.shopee.vn/verify/traffic/error?scene=a&u=123#frag";
const VERIFY_AT = "https://affiliate.shopee.vn/verify/traffic/error";
const LOGIN = "https://shopee.vn/buyer/login?next=https%3A%2F%2Faffiliate.shopee.vn";
const LOGIN_AT = "https://shopee.vn/buyer/login";
const ticket = (n: number): string => String(n).padStart(32, "0");
const JOBS: BridgeJob[] = [
  { ticket: ticket(1), kind: "link", sourceUrl: "https://shopee.vn/a-i.1.2", subId1: "C1", subId2: "R1", timeoutMs: 90_000 },
  { ticket: ticket(2), kind: "lookup", url: "https://shopee.vn/a-i.1.2", timeoutMs: 90_000 },
  { ticket: ticket(3), kind: "report", page: 1, purchaseTimeStart: 1, purchaseTimeEnd: 2, timeoutMs: 90_000 },
  { ticket: ticket(4), kind: "payout_record", timeoutMs: 90_000 },
];
const clock = () => ({ now: () => instantFromMs(Date.parse("2026-11-06T03:00:00.000Z")) });
const worker = (page: ReturnType<typeof fakePage>) => jobWorker(page, recordingWait(), undefined, undefined, clock());

/** A page whose every script sees only where the tab is, as any job's first look does. */
function parkedPage(over: Parameters<typeof fakePage>[0]) {
  const page = fakePage(over);
  page.run = async <R>() => ({ href: page.state.href, passwordBox: false, ready: false, state: "waiting" }) as R;
  return page;
}

describe("D69: pageAddress", () => {
  it("keeps origin and path, never a query string, a fragment or a login in the address", () => {
    expect(pageAddress(VERIFY)).toBe(VERIFY_AT);
    expect(pageAddress("https://user:pw@shopee.vn/verify/x")).toBe("https://shopee.vn/verify/x");
  });

  it("gives nothing for what is not a web page, and bounds a long path to what the contract takes", () => {
    expect(pageAddress("")).toBeUndefined();
    expect(pageAddress("chrome://newtab/")).toBeUndefined();
    const long = pageAddress(`https://shopee.vn/verify/${"a".repeat(2000)}`);
    expect(long).toHaveLength(BRIDGE_BLOCKED_AT_MAX_LENGTH);
    expect(bridgeResultSchema.safeParse({ ticket: ticket(1), outcome: "failed", reason: "captcha", blockedAt: long }).success).toBe(true);
  });
});

describe("D69: every job kind answers the blocked page", () => {
  it("a captcha after the fresh tab's second look names the page the last look saw, for all four kinds", async () => {
    for (const job of JOBS) {
      const page = parkedPage({ href: VERIFY, stuckAt: VERIFY, fresh: { href: VERIFY.replace("traffic", "second"), stuckAt: VERIFY.replace("traffic", "second") } });
      expect(await worker(page)(job)).toEqual({ outcome: "failed", reason: "captcha", blockedAt: VERIFY_AT.replace("traffic", "second") });
    }
  });

  it("a login page, which is never retried, names its page for all four kinds", async () => {
    for (const job of JOBS) {
      const page = parkedPage({ href: LOGIN, stuckAt: LOGIN });
      expect(await worker(page)(job)).toEqual({ outcome: "failed", reason: "login_redirect", blockedAt: LOGIN_AT });
    }
  });

  it("a report whose request sends the tab to a verification page answers that exact address", async () => {
    const page = fakePage({ href: REPORT_PAGE_URL, fresh: null });
    page.run = async <A, R>(func: (arg: A) => R): Promise<R> => {
      if (func === (fetchReportList as unknown)) {
        page.state.href = VERIFY;
        return { ok: false, why: "report_http_error" } as R;
      }
      return { href: page.state.href, passwordBox: false } as R;
    };
    expect(await worker(page)(JOBS[2] as BridgeJob)).toEqual({ outcome: "failed", reason: "captcha", blockedAt: VERIFY_AT });
  });

  it("a retry the bridge cannot make answers the address of the first look", async () => {
    const page = fakePage({ href: VERIFY, stuckAt: VERIFY, fresh: null });
    expect(await worker(page)(JOBS[0] as BridgeJob)).toEqual({ outcome: "failed", reason: "captcha", blockedAt: VERIFY_AT });
  });

  it("a second run that answers a page reason keeps the captcha and its address", async () => {
    const page = fakePage({ href: VERIFY, stuckAt: VERIFY });
    const look = page.run;
    page.run = async <A, R>(func: (arg: A) => R, arg: A): Promise<R> => {
      if (page.replacements() === 0) return look(func, arg);
      throw new Error("broke");
    };
    expect(await worker(page)(JOBS[0] as BridgeJob)).toEqual({ outcome: "failed", reason: "captcha", blockedAt: VERIFY_AT });
  });

  it("the serialised answer meets the contract", async () => {
    const answer = await worker(fakePage({ href: VERIFY, stuckAt: VERIFY, fresh: null }))(JOBS[0] as BridgeJob);
    expect(bridgeResultSchema.safeParse({ ...answer, ticket: ticket(1) }).success).toBe(true);
  });

  it("an answer that is not a block carries no page", async () => {
    const answer = await worker(fakePage({ formReady: false, fresh: null }))(JOBS[0] as BridgeJob);
    expect(answer).toEqual({ outcome: "failed", reason: "page_not_ready" });
  });
});

describe("D69: a frozen page", () => {
  const LOOK = { textarea: "t", subIdFields: [], result: "r", buttonLabel: "b" };
  function frozenChrome(landsAt?: string) {
    const chrome = fakeChrome([{ id: 9, url: "https://affiliate.shopee.vn/offer/custom_link" }]);
    chrome.landsAt = landsAt;
    Object.assign(chrome, { scripting: { executeScript: () => new Promise(() => undefined) } });
    return chrome;
  }

  it("a fresh tab whose address shows a block carries that address", async () => {
    const page = chromePageDriver(frozenChrome(VERIFY), recordingWait(), clock());
    await page.prepare();
    await expect(page.run(readPage, LOOK)).rejects.toMatchObject({ reason: "captcha", blockedAt: VERIFY_AT });
  });

  it("a fresh tab that shows no block carries none", async () => {
    const page = chromePageDriver(frozenChrome(), recordingWait(), clock());
    await page.prepare();
    const failure = await page.run(readPage, LOOK).catch((error: unknown) => error as { reason: string; blockedAt?: string });
    expect(failure).toMatchObject({ reason: "page_not_ready" });
    expect((failure as { blockedAt?: string }).blockedAt).toBeUndefined();
  });

  it("the tab the owner is on is answered from its own address", async () => {
    const chrome = fakeChrome([{ id: 9, url: VERIFY, active: true }]);
    Object.assign(chrome, { scripting: { executeScript: () => new Promise(() => undefined) } });
    chrome.windows.getLastFocused = async () => ({ focused: true, tabs: [{ id: 9, active: true }] });
    const page = chromePageDriver(chrome, recordingWait(), clock());
    await page.prepare();
    await expect(page.run(readPage, LOOK)).rejects.toMatchObject({ reason: "captcha", blockedAt: VERIFY_AT });
  });
});
