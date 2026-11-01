/**
 * Story 5.3: one link job on the custom link page, against a fake page. The page scripts are
 * answered by the fake; every wait is recorded, never slept.
 */
import type { BridgeLinkJob } from "@cashback/contracts";
import { describe, expect, it } from "vitest";

import { FORM_WAITS_MS, runLinkJob } from "../src/link-job";
import { CUSTOM_LINK_URL, SUB_ID_FIELDS } from "../src/shopee-page";
import { fakePage, recordingWait } from "./fakes";

const JOB: BridgeLinkJob = { ticket: "0".repeat(32), kind: "link", sourceUrl: "https://shopee.vn/Ao-i.11001.22001", subId1: "DEV1000000000000000001", subId2: "DEV26110100001", timeoutMs: 90_000 };

describe("Story 5.3: a link job on the custom link page", () => {
  it("fills one source link with the job's own sub_id1 and sub_id2, submits once and returns the new link", async () => {
    const page = fakePage({ result: "https://s.shopee.vn/PreviousCustomer" });
    const wait = recordingWait();
    expect(await runLinkJob(JOB, page, wait)).toEqual({ outcome: "link", url: "https://s.shopee.vn/New1" });
    expect(page.calls).toEqual(["prepare", "fill", "submit"]);
    expect(page.filled).toEqual([expect.objectContaining({ url: JOB.sourceUrl, subIds: [JOB.subId1, JOB.subId2], subIdFields: SUB_ID_FIELDS })]);
  });

  it("never reads the previous customer's link back as this one's", async () => {
    const page = fakePage({ result: "https://s.shopee.vn/PreviousCustomer", answer: { afterLooks: 5, link: "https://s.shopee.vn/PreviousCustomer" } });
    const answer = await runLinkJob({ ...JOB, timeoutMs: 40_000 }, page, recordingWait());
    expect(answer).toEqual({ outcome: "failed", reason: "no_link" });
  });

  it("opens the custom link page when the tab is elsewhere, and reloads once when the form never appears", async () => {
    const elsewhere = fakePage({ href: "https://affiliate.shopee.vn/dashboard" });
    await runLinkJob(JOB, elsewhere, recordingWait());
    expect(elsewhere.calls.slice(0, 2)).toEqual(["prepare", `open ${CUSTOM_LINK_URL}`]);

    const slow = fakePage({ formReady: false, formAfterOpens: 1 });
    expect((await runLinkJob(JOB, slow, recordingWait())).outcome).toBe("link");
    expect(slow.calls.filter((c) => c.startsWith("open"))).toEqual([`open ${CUSTOM_LINK_URL}`]);

    const broken = fakePage({ formReady: false });
    const wait = recordingWait();
    expect(await runLinkJob(JOB, broken, wait)).toEqual({ outcome: "failed", reason: "page_not_ready" });
    expect(wait.total()).toBe(FORM_WAITS_MS[0] + FORM_WAITS_MS[1]);
    expect(broken.calls).not.toContain("fill");
  });

  it("reports a verification page as captcha and a login page as login_redirect, without filling anything", async () => {
    const captcha = fakePage({ href: "https://shopee.vn/verify/traffic/error", stuckAt: "https://shopee.vn/verify/traffic/error" });
    expect(await runLinkJob(JOB, captcha, recordingWait())).toEqual({ outcome: "failed", reason: "captcha" });
    const login = fakePage({ href: "https://accounts.shopee.vn/seller/login?next=x", stuckAt: "https://accounts.shopee.vn/seller/login?next=x" });
    expect(await runLinkJob(JOB, login, recordingWait())).toEqual({ outcome: "failed", reason: "login_redirect" });
    const password = fakePage({ passwordBox: true });
    expect(await runLinkJob(JOB, password, recordingWait())).toEqual({ outcome: "failed", reason: "login_redirect" });
    for (const page of [captcha, login, password]) expect(page.calls).not.toContain("fill");
  });

  it("names a Shopee refusal, a missing button, more than one link, a non-Shopee link and a page that answers nothing", async () => {
    expect(await runLinkJob(JOB, fakePage({ answer: { afterLooks: 1, error: "Not in the affiliate programme" } }), recordingWait())).toEqual({ outcome: "failed", reason: "shopee_refused" });
    expect(await runLinkJob(JOB, fakePage({ buttonMissing: true }), recordingWait())).toEqual({ outcome: "failed", reason: "submit_failed" });
    expect(await runLinkJob(JOB, fakePage({ answer: { afterLooks: 1, link: "https://s.shopee.vn/A\nhttps://s.shopee.vn/B" } }), recordingWait())).toEqual({ outcome: "failed", reason: "no_link" });
    expect(await runLinkJob(JOB, fakePage({ answer: { afterLooks: 1, link: "http://s.shopee.vn/A" } }), recordingWait())).toEqual({ outcome: "failed", reason: "no_link" });
    expect(await runLinkJob(JOB, fakePage({ answer: { afterLooks: 1, link: "https://shopee.vn.evil.example/A" } }), recordingWait())).toEqual({ outcome: "failed", reason: "no_link" });
    const silent = recordingWait();
    expect(await runLinkJob(JOB, fakePage({ answer: null }), silent)).toEqual({ outcome: "failed", reason: "no_link" });
    // The answer is due before the server stops waiting (the job timeout plus its grace).
    expect(silent.total()).toBeLessThan(JOB.timeoutMs);
  });

  it("refuses a job whose source is not a Shopee link, and turns a script exception into script_error", async () => {
    const page = fakePage();
    expect(await runLinkJob({ ...JOB, sourceUrl: "https://evil.example/x" }, page, recordingWait())).toEqual({ outcome: "failed", reason: "bad_job" });
    expect(page.calls).toEqual([]);
    const throwing = { ...fakePage(), prepare: async () => Promise.reject(new Error("no tab")) };
    expect(await runLinkJob(JOB, throwing, recordingWait())).toEqual({ outcome: "failed", reason: "script_error" });
  });
});
