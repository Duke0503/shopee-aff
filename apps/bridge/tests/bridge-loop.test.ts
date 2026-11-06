/**
 * Story 5.3, extension side: the loop takes one job at a time, never waits for work itself (the
 * server holds the poll), and keeps going through a server restart. The server is a scripted fake.
 */
import type { BridgeJob, BridgeResult } from "@cashback/contracts";
import { instantFromMs } from "@cashback/core";
import { describe, expect, it } from "vitest";

import { jobWorker, POST_TRIES, RETRY_MAX_MS, runBridgeLoop, type Answer, type LoopDeps } from "../src/bridge-loop";
import type { ConnectedSettings } from "../src/bridge-settings";
import { Blocked, chromePageDriver } from "../src/bridge-tab";
import { BEFORE_SUBMIT_MS, RESULT_POLL_MS, resultWaitMs } from "../src/link-job";
import { fillForm, pressSubmit, readPage, readResult, readResultBox } from "../src/page-scripts";
import type { Poll, ServerClient } from "../src/server-client";
import { CUSTOM_LINK_URL } from "../src/shopee-page";
import { fakeChrome, fakePage, recordingWait } from "./fakes";

const SETTINGS: ConnectedSettings = { serverOrigin: "http://127.0.0.1:9081", token: "b".repeat(40), instance: "a".repeat(32) };
const ticket = (n: number) => n.toString(16).padStart(32, "0");
const linkJob = (n: number): BridgeJob => ({ ticket: ticket(n), kind: "link", sourceUrl: "https://shopee.vn/x-i.1.2", subId1: "DEV1000000000000000001", subId2: `DEV2611010000${n}`, timeoutMs: 90_000 });

type Step = Poll | "down" | "end";

/** A server that answers each poll from the script, then ends the loop. */
function scriptedServer(steps: Step[], postFailures = 0) {
  const events: string[] = [];
  const posted: BridgeResult[] = [];
  const stop = { stopped: false };
  let failuresLeft = postFailures;
  const client: ServerClient = {
    next: async () => {
      events.push("poll");
      const step = steps.shift() ?? "end";
      if (step === "end") {
        stop.stopped = true;
        return { kind: "idle" };
      }
      if (step === "down") throw new TypeError("fetch failed");
      return step;
    },
    post: async (result) => {
      if (failuresLeft-- > 0) throw new TypeError("fetch failed");
      events.push(`post ${result.ticket.slice(-1)} ${result.outcome}`);
      posted.push(result);
      return true;
    },
    verificationCleared: async () => false,
  };
  return { client, events, posted, stop };
}

function deps(server: ReturnType<typeof scriptedServer>, work: (job: BridgeJob) => Promise<Answer>, wait = recordingWait()): LoopDeps & { wait: ReturnType<typeof recordingWait>; logs: string[] } {
  const logs: string[] = [];
  return { loadSettings: async () => SETTINGS, client: () => server.client, work, wait, log: (event) => void logs.push(event), logs };
}

describe("Story 5.3: the extension takes one job at a time", () => {
  it("AC1: it works one job to its answer before it polls again, so only one job is ever in hand", async () => {
    const server = scriptedServer([{ kind: "job", job: linkJob(1) }, { kind: "job", job: linkJob(2) }]);
    let inHand = 0;
    let most = 0;
    const work = async (job: BridgeJob): Promise<Answer> => {
      inHand++;
      most = Math.max(most, inHand);
      server.events.push(`work ${job.ticket.slice(-1)}`);
      await Promise.resolve();
      inHand--;
      return { outcome: "link", url: "https://s.shopee.vn/A" };
    };
    expect(await runBridgeLoop(deps(server, work), server.stop)).toBe("stopped");
    expect(server.events).toEqual(["poll", "work 1", "post 1 link", "poll", "work 2", "post 2 link", "poll"]);
    expect(most).toBe(1);
    expect(server.posted.map((r) => r.ticket)).toEqual([ticket(1), ticket(2)]);
  });

  it("AC1: a lookup is worked (Story 5.6), and one whose link names no product touches no page; a report page job is worked too (Story 5.9)", async () => {
    const page = fakePage();
    const work = jobWorker(page, recordingWait());
    expect(await work({ ticket: ticket(1), kind: "lookup", url: "https://shopee.vn/x", timeoutMs: 90_000 })).toEqual({ outcome: "value", value: { found: false } });
    expect(page.calls).toEqual([]);
    expect(await work({ ticket: ticket(2), kind: "report", page: 2, purchaseTimeStart: 20, purchaseTimeEnd: 10, timeoutMs: 90_000 })).toEqual({ outcome: "failed", reason: "bad_job" });
    expect(page.calls).toEqual([]);
  });

  it("AC2: after an empty poll it polls again at once; it never waits for work itself", async () => {
    const server = scriptedServer([{ kind: "idle" }, { kind: "idle" }, { kind: "idle" }]);
    const d = deps(server, async () => ({ outcome: "failed", reason: "no_link" }));
    await runBridgeLoop(d, server.stop);
    expect(server.events).toEqual(["poll", "poll", "poll", "poll"]);
    expect(d.wait.calls).toEqual([]);
  });

  it("survives a server restart: an unreachable server is retried with a growing pause, then polling goes on", async () => {
    const steps: Step[] = [...Array<Step>(8).fill("down"), { kind: "job", job: linkJob(1) }];
    const server = scriptedServer(steps);
    const d = deps(server, async () => ({ outcome: "link", url: "https://s.shopee.vn/A" }));
    await runBridgeLoop(d, server.stop);
    expect(d.wait.calls).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, RETRY_MAX_MS, RETRY_MAX_MS, RETRY_MAX_MS]);
    expect(server.posted).toHaveLength(1);
    expect(d.logs.filter((l) => l === "bridge.server.unreachable")).toHaveLength(8);
  });

  it("an answer that cannot be posted is retried, then dropped (the server gives the job out again); a work error is answered script_error", async () => {
    const server = scriptedServer([{ kind: "job", job: linkJob(1) }], POST_TRIES - 1);
    await runBridgeLoop(deps(server, async () => Promise.reject(new Error("tab closed"))), server.stop);
    expect(server.posted).toEqual([{ ticket: ticket(1), outcome: "failed", reason: "script_error" }]);

    const lost = scriptedServer([{ kind: "job", job: linkJob(2) }], POST_TRIES);
    const d = deps(lost, async () => ({ outcome: "link", url: "https://s.shopee.vn/A" }));
    await runBridgeLoop(d, lost.stop);
    expect(lost.posted).toEqual([]);
    expect(d.logs).toContain("bridge.result.dropped");
  });

  it("ends without settings or with a refused token, for the keep-alive alarm to start it again", async () => {
    const server = scriptedServer([{ kind: "unauthorized" }]);
    expect(await runBridgeLoop(deps(server, async () => ({ outcome: "failed", reason: "no_link" })), server.stop)).toBe("unauthorized");
    const none = scriptedServer([]);
    expect(await runBridgeLoop({ ...deps(none, async () => ({ outcome: "failed", reason: "no_link" })), loadSettings: async () => null }, none.stop)).toBe("no_settings");
    expect(none.events).toEqual([]);
  });
});

describe("D68: a fresh tab before a captcha or a frozen page is reported", () => {
  const VERIFY = "https://affiliate.shopee.vn/verify/traffic?x=1";
  const LINK = { outcome: "link", url: "https://s.shopee.vn/New1" };
  const CAPTCHA = { outcome: "failed", reason: "captcha" };
  const report = (n: number): BridgeJob => ({ ticket: ticket(n), kind: "report", page: 1, purchaseTimeStart: 1, purchaseTimeEnd: 2, timeoutMs: 90_000 });
  const lookup: BridgeJob = { ticket: ticket(5), kind: "lookup", url: "https://shopee.vn/x-i.1.2", timeoutMs: 90_000 };
  const payout: BridgeJob = { ticket: ticket(6), kind: "payout_record", timeoutMs: 90_000 };
  function clockAt() {
    let ms = Date.parse("2026-11-06T03:00:00.000Z");
    return { now: () => instantFromMs(ms), advance: (by: number) => void (ms += by) };
  }
  const worker = (page: ReturnType<typeof fakePage>, clock = clockAt()) => jobWorker(page, recordingWait(), undefined, undefined, clock);
  const onCaptcha = (over: Parameters<typeof fakePage>[0] = {}) => fakePage({ href: VERIFY, stuckAt: VERIFY, ...over });

  it("captcha, fresh tab clean: the old tab goes, the job runs again and succeeds, so no hold and no alert", async () => {
    const page = onCaptcha();
    expect(await worker(page)(linkJob(1))).toEqual(LINK);
    expect(page.calls.filter((c) => c === "replace")).toHaveLength(1);
    expect(page.calls.filter((c) => c === "prepare")).toHaveLength(2);
    expect(page.calls.filter((c) => c === "submit")).toHaveLength(1);
  });

  it("captcha, fresh tab on a verification or login page too: answered as such with no further page load", async () => {
    const page = onCaptcha({ fresh: { href: VERIFY } });
    expect(await worker(page)(linkJob(1))).toEqual(CAPTCHA);
    expect(page.calls.filter((c) => c.startsWith("open") || c === "prepare")).toEqual(["prepare", `open ${CUSTOM_LINK_URL}`]);
    expect(await worker(onCaptcha({ fresh: { href: "https://shopee.vn/buyer/login" } }))(linkJob(1))).toEqual({ outcome: "failed", reason: "login_redirect" });
  });

  it("captcha, still blocked on the second run: answers captcha, with one retry only", async () => {
    const page = onCaptcha({ fresh: { href: CUSTOM_LINK_URL, stuckAt: VERIFY } });
    const look = page.run;
    page.run = async <A, R>(func: (arg: A) => R, arg: A): Promise<R> => {
      if (func === (readPage as unknown)) page.state.href = VERIFY;
      return look(func, arg);
    };
    expect(await worker(page)(linkJob(1))).toEqual(CAPTCHA);
    expect(page.calls.filter((c) => c === "replace")).toHaveLength(1);
    expect(page.calls.filter((c) => c === "prepare")).toHaveLength(2);
  });

  it("no fresh tab to be had (the owner on the tab, the cooldown, a browser that opens none): answers captcha at once", async () => {
    const page = onCaptcha({ fresh: null });
    expect(await worker(page)(linkJob(1))).toEqual(CAPTCHA);
    expect(page.calls.filter((c) => c === "prepare")).toHaveLength(1);
  });

  it("a late retry is skipped: more than half of the job's time used answers the first result", async () => {
    const clock = clockAt();
    const page = onCaptcha();
    const prepare = page.prepare;
    page.prepare = async () => {
      clock.advance(45_001);
      await prepare();
    };
    expect(await worker(page, clock)(linkJob(1))).toEqual(CAPTCHA);
    expect(page.calls).not.toContain("replace");
  });

  it("exactly half used still retries, and the second run has only what is left of the job's time", async () => {
    const clock = clockAt();
    const page = onCaptcha({ answer: null });
    const prepare = page.prepare;
    page.prepare = async () => {
      if (page.calls.length === 0) clock.advance(60_000);
      await prepare();
    };
    const wait = recordingWait();
    expect(await jobWorker(page, wait, undefined, undefined, clock)({ ...linkJob(1), timeoutMs: 120_000 })).toEqual(CAPTCHA);
    expect(page.calls).toContain("replace");
    // The result box is watched for what is left (60 s), not the whole 120 s.
    expect(wait.total()).toBeLessThanOrEqual(resultWaitMs(60_000, false) + RESULT_POLL_MS + BEFORE_SUBMIT_MS);
  });

  it("opening the fresh tab can use up the time: over half used after it answers the first result", async () => {
    const clock = clockAt();
    const page = onCaptcha();
    const replace = page.replaceTab;
    page.replaceTab = async () => {
      clock.advance(45_001);
      return replace();
    };
    expect(await worker(page, clock)(linkJob(1))).toEqual(CAPTCHA);
    expect(page.calls.filter((c) => c === "prepare")).toHaveLength(1);
  });

  it("a second run's no_link, page_not_ready, form_missing or script_error does not hide the captcha; a second run's other answer stands", async () => {
    for (const reason of ["no_link", "page_not_ready", "form_missing", "script_error", "shopee_refused"] as const) {
      const page = onCaptcha();
      const look = page.run;
      page.run = async <A, R>(func: (arg: A) => R, arg: A): Promise<R> => {
        if (page.replacements() === 0) return look(func, arg);
        if (func !== (readPage as unknown)) return look(func, arg);
        return { href: CUSTOM_LINK_URL, ready: true, passwordBox: false } as R;
      };
      page.state.answer = reason === "shopee_refused" ? { afterLooks: 0, error: "no" } : null;
      const answers: Record<string, () => void> = {
        form_missing: () => (page.state.formReady = false),
        page_not_ready: () => (page.run = async () => Promise.reject(new Blocked("page_not_ready"))),
        script_error: () => (page.run = async () => Promise.reject(new Error("broke"))),
      };
      const replace = page.replaceTab;
      page.replaceTab = async () => {
        const fresh = await replace();
        answers[reason]?.();
        return fresh;
      };
      if (reason === "form_missing") {
        const fill = page.run;
        page.run = async <A, R>(func: (arg: A) => R, arg: A): Promise<R> => {
          if (page.replacements() > 0 && func === (fillForm as unknown)) return { ok: false, why: "gone" } as R;
          return fill(func, arg);
        };
      }
      expect([reason, await worker(page)(linkJob(1))]).toEqual([reason, reason === "shopee_refused" ? { outcome: "failed", reason } : CAPTCHA]);
    }
  });

  it("a login page is never retried, nor any other failure; a page that never showed its form is not a frozen page", async () => {
    const login = fakePage({ href: "https://shopee.vn/buyer/login", stuckAt: "https://shopee.vn/buyer/login" });
    expect(await worker(login)(linkJob(1))).toEqual({ outcome: "failed", reason: "login_redirect" });
    expect(login.calls).not.toContain("replace");
    const noForm = fakePage({ formReady: false });
    expect(await worker(noForm)(linkJob(1))).toEqual({ outcome: "failed", reason: "page_not_ready" });
    expect(noForm.calls).not.toContain("replace");
    expect(noForm.calls.filter((c) => c === "prepare")).toHaveLength(1);
    const refused = fakePage({ answer: { afterLooks: 0, error: "no" } });
    expect(await worker(refused)(linkJob(1))).toEqual({ outcome: "failed", reason: "shopee_refused" });
    expect(refused.calls).not.toContain("replace");
  });

  it("all four job kinds pass the same retry", async () => {
    for (const job of [linkJob(1), report(2), lookup, payout]) {
      const page = onCaptcha({ fresh: { href: VERIFY } });
      page.run = async () => Promise.reject(new Blocked("captcha"));
      expect(await worker(page)(job)).toEqual(CAPTCHA);
      expect(page.calls).toContain("replace");
    }
  });

  /** A Chrome whose first scripts hang (a frozen tab) and whose later ones answer as the custom link page does. */
  function freezing(firstHung: number, tabs = [{ id: 9, url: CUSTOM_LINK_URL, pinned: true }]) {
    const chrome = fakeChrome(tabs);
    let scripts = 0;
    let looks = 0;
    const executeScript = (injection: { func: unknown }) => {
      if (++scripts <= firstHung) return new Promise(() => undefined);
      const answer = (result: unknown) => Promise.resolve([{ result }]);
      if (injection.func === readPage) return answer({ href: CUSTOM_LINK_URL, ready: true, passwordBox: false });
      if (injection.func === readResultBox) return answer("");
      if (injection.func === fillForm || injection.func === pressSubmit) return answer({ ok: true });
      if (injection.func === readResult) return answer(++looks > 1 ? { state: "link", links: ["https://s.shopee.vn/New1"] } : { state: "waiting" });
      return answer(null);
    };
    Object.assign(chrome, { scripting: { executeScript } });
    return chrome;
  }

  it("frozen tab: replaced once, the job runs again in the fresh tab and succeeds", async () => {
    const chrome = freezing(1);
    const clock = clockAt();
    const page = chromePageDriver(chrome, recordingWait(), clock);
    expect(await jobWorker(page, recordingWait(), undefined, undefined, clock)(linkJob(1))).toEqual(LINK);
    expect(chrome.created).toHaveLength(1);
    expect(chrome.removed).toEqual([9]);
  });

  it("still frozen in the fresh tab: page_not_ready as today, with no second replacement in the job", async () => {
    const chrome = freezing(Number.POSITIVE_INFINITY);
    const clock = clockAt();
    const page = chromePageDriver(chrome, recordingWait(), clock);
    expect(await jobWorker(page, recordingWait(), undefined, undefined, clock)(linkJob(1))).toEqual({ outcome: "failed", reason: "page_not_ready" });
    expect(chrome.created).toHaveLength(1);
    expect(chrome.removed).toEqual([9]);
  });

  it("frozen with a captcha behind it: the fresh tab's address was the second look, and no further load is made", async () => {
    const chrome = freezing(Number.POSITIVE_INFINITY);
    chrome.landsAt = VERIFY;
    const clock = clockAt();
    const page = chromePageDriver(chrome, recordingWait(), clock);
    expect(await jobWorker(page, recordingWait(), undefined, undefined, clock)(linkJob(1))).toEqual(CAPTCHA);
    expect(chrome.created).toHaveLength(1);
    expect(chrome.updates.filter((u) => u.properties["url"] !== undefined)).toEqual([]);
  });

  it("a frozen tab inside the cooldown is not retried", async () => {
    const chrome = freezing(Number.POSITIVE_INFINITY);
    const clock = clockAt();
    const page = chromePageDriver(chrome, recordingWait(), clock);
    const work = jobWorker(page, recordingWait(), undefined, undefined, clock);
    await work(linkJob(1));
    expect(chrome.created).toHaveLength(1);
    expect(await work(linkJob(2))).toEqual({ outcome: "failed", reason: "page_not_ready" });
    expect(chrome.created).toHaveLength(1);
  });

  it("the tab the owner is on is not replaced, and its captcha is answered at once", async () => {
    const chrome = freezing(0, [{ id: 9, url: VERIFY, pinned: true, active: true } as never]);
    Object.assign(chrome, { scripting: { executeScript: async () => [{ result: { href: VERIFY, ready: false, passwordBox: false } }] } });
    const clock = clockAt();
    const page = chromePageDriver(chrome, recordingWait(), clock);
    expect(await jobWorker(page, recordingWait(), undefined, undefined, clock)(linkJob(1))).toEqual(CAPTCHA);
    expect([chrome.created, chrome.removed]).toEqual([[], []]);
  });
});
