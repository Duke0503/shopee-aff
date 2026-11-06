/**
 * Story 5.3 AC5 and restarts: the bridge tab is pinned and never discarded, found again after a
 * restart, reloaded when Chrome discarded it anyway, and the service starts the loop on every
 * wake-up event with at most one loop running. A fake Chrome API, no browser.
 */
import { BRIDGE_INSTANCE_HEADER } from "@cashback/contracts";
import { instantFromMs } from "@cashback/core";
import { describe, expect, it } from "vitest";

import { bridgeService, KEEPALIVE_ALARM, KEEPALIVE_MINUTES } from "../src/bridge-service";
import { Blocked, chromePageDriver, REPLACE_TAB_EVERY_MS, SCRIPT_ANSWER_MS, SPARE_TAB_MAX_MS, TAB_ID_KEY } from "../src/bridge-tab";
import { runLinkJob } from "../src/link-job";
import { readPage } from "../src/page-scripts";
import { runReportJob } from "../src/report-job";
import type { Fetch } from "../src/server-client";
import type { FollowLink } from "../src/short-link";
import { VERIFICATION_TABS_KEY } from "../src/verification-watch";
import { CUSTOM_LINK_URL } from "../src/shopee-page";
import { fakeChrome, recordingWait } from "./fakes";

const SETTINGS = { serverUrl: "http://127.0.0.1:9081", token: "b".repeat(40) };
/** Not random: the bytes 0, 1, 2 ... so the instance id is known. */
const NO_FOLLOW: FollowLink = () => Promise.reject(new Error("no short link is followed here"));
const SEQUENCE = (length: number) => Uint8Array.from({ length }, (_, i) => i);

describe("Story 5.3 AC5: the bridge tab is kept alive", () => {
  it("opens the custom link page in a pinned background tab and turns automatic discarding off", async () => {
    const chrome = fakeChrome();
    const page = chromePageDriver(chrome, recordingWait());
    await page.prepare();
    expect(chrome.created).toEqual([{ url: CUSTOM_LINK_URL, pinned: true, active: false }]);
    expect(chrome.updates).toEqual([{ tabId: 101, properties: { pinned: true, autoDiscardable: false } }]);
  });

  it("after a browser or extension restart finds the open affiliate tab again instead of opening another, and reloads it when it was discarded", async () => {
    const chrome = fakeChrome([{ id: 7, url: "https://shopee.vn/" }, { id: 9, url: `${CUSTOM_LINK_URL}?x=1`, discarded: true }]);
    const page = chromePageDriver(chrome, recordingWait());
    await page.prepare();
    expect(chrome.created).toEqual([]);
    expect(page.tabId()).toBe(9);
    expect(chrome.updates).toEqual([{ tabId: 9, properties: { pinned: true, autoDiscardable: false } }]);
    expect(chrome.reloads).toEqual([9]);
    // The tab was closed by hand: the next job opens a new one.
    chrome.openTabs = [];
    await page.prepare();
    expect(chrome.created).toHaveLength(1);
  });
});

describe("fix(bridge): one tab, also after the worker restarts on a storefront page", () => {
  it("a restarted worker finds its tab by the stored id even when a lookup left it on shopee.vn, and opens no other", async () => {
    const chrome = fakeChrome();
    await chromePageDriver(chrome, recordingWait()).prepare();
    expect(chrome.store[TAB_ID_KEY]).toBe(101);
    chrome.openTabs[0] = { ...chrome.openTabs[0], url: "https://shopee.vn/product/1/2" };
    const restarted = chromePageDriver(chrome, recordingWait());
    await restarted.prepare();
    expect(restarted.tabId()).toBe(101);
    expect(chrome.created).toHaveLength(1);
  });

  it("without a stored id takes a pinned Shopee tab, and closes the other pinned Shopee tabs but never an unpinned one", async () => {
    const chrome = fakeChrome([
      { id: 3, url: "https://shopee.vn/product/1/2", pinned: true },
      { id: 4, url: "https://affiliate.shopee.vn/offer/custom_link", pinned: true },
      { id: 5, url: "https://shopee.vn/verify/traffic", pinned: true },
      { id: 6, url: "https://affiliate.shopee.vn/report", pinned: false },
      { id: 7, url: "https://mail.example.com/", pinned: true },
    ]);
    const page = chromePageDriver(chrome, recordingWait());
    await page.prepare();
    expect(page.tabId()).toBe(3);
    expect(chrome.created).toEqual([]);
    expect(chrome.removed).toEqual([4, 5]);
    expect(chrome.openTabs.map((t) => t.id)).toEqual([3, 6, 7]);
  });

  it("a stored id that now belongs to a tab off Shopee (ids restart with the browser) is not taken", async () => {
    const chrome = fakeChrome([{ id: 3, url: "https://mail.example.com/", pinned: true }], { [TAB_ID_KEY]: 3 });
    const page = chromePageDriver(chrome, recordingWait());
    await page.prepare();
    expect(page.tabId()).toBe(101);
    expect(chrome.removed).toEqual([]);
  });
});

describe("Story 5.3: the service worker survives restarts", () => {
  const idleFetch: Fetch = async () => ({ status: 204, json: async () => null });

  it("registers its wake-up listeners and a 30-second keep-alive alarm, and the alarm re-marks the tab and restarts a stopped loop", async () => {
    const chrome = fakeChrome([{ id: 9, url: CUSTOM_LINK_URL }], { ...SETTINGS });
    const stop = { stopped: false };
    let polls = 0;
    const fetch: Fetch = async () => {
      polls++;
      if (polls >= 2) stop.stopped = true;
      return { status: 204, json: async () => null };
    };
    const service = bridgeService({ chrome, fetch, follow: NO_FOLLOW, wait: recordingWait(), randomBytes: SEQUENCE, log: () => undefined }, stop);
    service.install();
    expect(Object.keys(chrome.listeners).sort()).toEqual(["action.onClicked", "alarms.onAlarm", "runtime.onInstalled", "runtime.onStartup", "storage.onChanged", "tabs.onRemoved", "tabs.onUpdated"]);
    expect(chrome.alarmsCreated).toEqual([{ name: KEEPALIVE_ALARM, periodInMinutes: KEEPALIVE_MINUTES }]);
    expect(KEEPALIVE_MINUTES).toBe(0.5);
    expect(await service.start()).toBe("stopped");
    expect(service.isRunning()).toBe(false);

    await chromePageDriver(chrome, recordingWait()).prepare();
    stop.stopped = false;
    polls = 0;
    for (const fire of chrome.listeners["alarms.onAlarm"] ?? []) (fire as (a: { name: string }) => void)({ name: KEEPALIVE_ALARM });
    expect(service.isRunning()).toBe(true);
    expect(await service.start()).toBe("stopped");
    expect(polls).toBe(2);
  });

  it("never runs two loops at once, and ends without settings until they are saved", async () => {
    const chrome = fakeChrome();
    const service = bridgeService({ chrome, fetch: idleFetch, follow: NO_FOLLOW, wait: recordingWait(), randomBytes: SEQUENCE, log: () => undefined });
    const first = service.start();
    expect(service.start()).toBe(first);
    expect(await first).toBe("no_settings");
  });
});

describe("Story 5.3 review 5: one stable instance id per profile", () => {
  it("makes its instance id once, keeps it in the profile and sends the same id after a worker or browser restart", async () => {
    const chrome = fakeChrome([], { ...SETTINGS });
    const sent: string[] = [];
    const stop = { stopped: false };
    const fetch: Fetch = async (_url, init) => {
      sent.push(init.headers[BRIDGE_INSTANCE_HEADER] ?? "");
      stop.stopped = true;
      return { status: 204, json: async () => null };
    };
    const deps = { chrome, fetch, follow: NO_FOLLOW, wait: recordingWait(), randomBytes: SEQUENCE, log: () => undefined };
    await bridgeService(deps, stop).start();
    const id = "000102030405060708090a0b0c0d0e0f";
    expect(chrome.store["instanceId"]).toBe(id);
    stop.stopped = false;
    // A restart makes a new worker with other random bytes; the stored id is kept.
    await bridgeService({ ...deps, randomBytes: (n: number) => new Uint8Array(n).fill(255) }, stop).start();
    expect(sent).toEqual([id, id]);
  });
});

describe("fix(shopee): replace a frozen tab and report what the fresh one shows", () => {
  const JOB = { ticket: "0".repeat(32), kind: "link", sourceUrl: "https://shopee.vn/Ao-i.11001.22001", subId1: "DEV1000000000000000001", subId2: "DEV26110100001", timeoutMs: 90_000 } as const;
  const CAPTCHA = "https://affiliate.shopee.vn/verify/traffic?x=1";
  const LOOK = { textarea: "t", subIdFields: [], result: "r", buttonLabel: "b" };

  /** A tab whose page answers no script, as on 19 Oct 2026 behind a captcha; tab-level calls still answer. */
  function frozenChrome(landsAt?: string) {
    const chrome = fakeChrome([{ id: 7, url: "https://shopee.vn/" }, { id: 9, url: CUSTOM_LINK_URL }]);
    chrome.landsAt = landsAt;
    Object.assign(chrome, { scripting: { executeScript: () => new Promise(() => undefined) } });
    return chrome;
  }
  function movingClock(at = "2026-11-02T03:00:00.000Z") {
    let ms = Date.parse(at);
    return { now: () => instantFromMs(ms), advance: (by: number) => void (ms += by) };
  }

  it("a page script that never answers opens a fresh custom link tab, closes only the frozen one, and the next job works in the fresh tab", async () => {
    const chrome = frozenChrome();
    const wait = recordingWait();
    const page = chromePageDriver(chrome, wait, movingClock());
    await page.prepare();
    await expect(page.run(readPage, LOOK)).rejects.toEqual(new Blocked("page_not_ready"));
    expect(wait.calls).toContain(SCRIPT_ANSWER_MS);
    expect(chrome.removed).toEqual([9]);
    expect(chrome.created).toEqual([{ url: CUSTOM_LINK_URL, pinned: true, active: false }]);
    expect(page.tabId()).toBe(101);
    expect(chrome.openTabs.map((t) => t.id)).toEqual([7, 101]);
  });

  it("a captcha or the login page behind a frozen tab is answered as such, read from the fresh tab's address without a script", async () => {
    const captcha = chromePageDriver(frozenChrome(CAPTCHA), recordingWait(), movingClock());
    await captcha.prepare();
    expect(await runLinkJob(JOB, captcha, recordingWait())).toMatchObject({ outcome: "failed", reason: "captcha" });
    const login = chromePageDriver(frozenChrome("https://shopee.vn/buyer/login?next=x"), recordingWait(), movingClock());
    await login.prepare();
    await expect(login.run(readPage, LOOK)).rejects.toMatchObject({ reason: "login_redirect" });
  });

  it("a report job on a frozen page answers what the fresh tab shows too (the other jobs share the same driver)", async () => {
    const page = chromePageDriver(frozenChrome(CAPTCHA), recordingWait(), movingClock());
    expect(await runReportJob({ ticket: "a".repeat(32), kind: "report", page: 1, purchaseTimeStart: 1, purchaseTimeEnd: 2, timeoutMs: 90_000 }, page, recordingWait())).toMatchObject({ outcome: "failed", reason: "captcha" });
  });

  it("is done at most once every 5 minutes, so a page that keeps freezing cannot loop", async () => {
    const chrome = frozenChrome(CAPTCHA);
    const clock = movingClock();
    const page = chromePageDriver(chrome, recordingWait(), clock);
    await page.prepare();
    await expect(page.run(readPage, LOOK)).rejects.toMatchObject({ reason: "captcha" });
    clock.advance(REPLACE_TAB_EVERY_MS - 1);
    await expect(page.run(readPage, LOOK)).rejects.toEqual(new Blocked("page_not_ready"));
    expect(chrome.created).toHaveLength(1);
    clock.advance(1);
    await expect(page.run(readPage, LOOK)).rejects.toMatchObject({ reason: "captcha" });
    expect(chrome.created).toHaveLength(2);
    expect(chrome.removed).toEqual([9, 101]);
  });

  it("a page that answers is never replaced", async () => {
    const chrome = fakeChrome([{ id: 9, url: CUSTOM_LINK_URL }]);
    Object.assign(chrome, { scripting: { executeScript: async () => [{ result: { href: CUSTOM_LINK_URL, ready: true, passwordBox: false } }] } });
    const page = chromePageDriver(chrome, recordingWait(), movingClock());
    await page.prepare();
    expect(await page.run(readPage, LOOK)).toEqual({ href: CUSTOM_LINK_URL, ready: true, passwordBox: false });
    expect([chrome.created, chrome.removed]).toEqual([[], []]);
  });
});

describe("D68: one custom link tab", () => {
  const LINK_TAB = `${CUSTOM_LINK_URL}?x=1`;

  it("closes another custom link tab at the next job, pinned or not, and never another unpinned Shopee tab", async () => {
    const chrome = fakeChrome([
      { id: 3, url: CUSTOM_LINK_URL, pinned: true },
      { id: 4, url: LINK_TAB, pinned: false },
      { id: 5, url: CUSTOM_LINK_URL, pinned: true },
      { id: 6, url: "https://affiliate.shopee.vn/report/conversion_report", pinned: false },
      { id: 7, url: "https://shopee.vn/verify/traffic", pinned: false },
    ]);
    await chromePageDriver(chrome, recordingWait()).prepare();
    expect(chrome.removed.sort()).toEqual([4, 5]);
    expect(chrome.openTabs.map((t) => t.id)).toEqual([3, 6, 7]);
  });

  it("spares the active tab of the focused window, pinned or not, and closes it once the owner has left it", async () => {
    const chrome = fakeChrome([
      { id: 3, url: CUSTOM_LINK_URL, pinned: true },
      { id: 4, url: LINK_TAB, pinned: false, active: true },
    ]);
    const page = chromePageDriver(chrome, recordingWait());
    await page.prepare();
    expect(chrome.removed).toEqual([]);
    chrome.openTabs = [{ id: 3, url: CUSTOM_LINK_URL, pinned: true }, { id: 4, url: LINK_TAB, pinned: false }];
    await page.prepare();
    expect(chrome.removed).toEqual([4]);
    const pinnedFront = fakeChrome([{ id: 3, url: CUSTOM_LINK_URL, pinned: true }, { id: 5, url: "https://shopee.vn/verify/traffic", pinned: true, active: true }]);
    await chromePageDriver(pinnedFront, recordingWait()).prepare();
    expect(pinnedFront.removed).toEqual([]);
  });

  it("ignores a close that fails", async () => {
    const chrome = fakeChrome([{ id: 3, url: CUSTOM_LINK_URL, pinned: true }, { id: 4, url: LINK_TAB }]);
    Object.assign(chrome.tabs, { remove: () => Promise.reject(new Error("gone")) });
    await expect(chromePageDriver(chrome, recordingWait()).prepare()).resolves.toBeUndefined();
  });
});

/** The same Chrome, with an extra custom link tab for `prepare` to look at. */
function fakeChromeSharing(chrome: ReturnType<typeof fakeChrome>): ReturnType<typeof fakeChrome> {
  chrome.openTabs = [...chrome.openTabs, { id: 77, url: CUSTOM_LINK_URL }];
  return chrome;
}

describe("D68: replacing the tab for a job", () => {
  const CAPTCHA = "https://affiliate.shopee.vn/verify/traffic?x=1";
  function clockAt() {
    let ms = Date.parse("2026-11-06T03:00:00.000Z");
    return { now: () => instantFromMs(ms), advance: (by: number) => void (ms += by) };
  }

  it("opens a fresh tab, closes the old one and says what the fresh one shows", async () => {
    const chrome = fakeChrome([{ id: 9, url: CAPTCHA, pinned: true }]);
    const page = chromePageDriver(chrome, recordingWait(), clockAt());
    await page.prepare();
    expect(await page.replaceTab()).toEqual({ shows: null });
    expect(chrome.removed).toEqual([9]);
    expect(page.tabId()).toBe(101);
    expect(page.replacements()).toBe(1);
    expect(chrome.store[TAB_ID_KEY]).toBe(101);
  });

  it("leaves the tab the owner is on: no replacement", async () => {
    const chrome = fakeChrome([{ id: 9, url: CAPTCHA, pinned: true, active: true }]);
    const page = chromePageDriver(chrome, recordingWait(), clockAt());
    await page.prepare();
    expect(await page.replaceTab()).toBeNull();
    expect([chrome.created, chrome.removed, page.replacements()]).toEqual([[], [], 0]);
  });

  it("a frozen tab the owner is on stays too, and is answered from its address", async () => {
    const chrome = fakeChrome([{ id: 9, url: CAPTCHA, pinned: true, active: true }]);
    Object.assign(chrome, { scripting: { executeScript: () => new Promise(() => undefined) } });
    const page = chromePageDriver(chrome, recordingWait(), clockAt());
    await page.prepare();
    await expect(page.run(readPage, { textarea: "t", subIdFields: [], result: "r", buttonLabel: "b" })).rejects.toMatchObject({ reason: "captcha" });
    expect([chrome.created, chrome.removed]).toEqual([[], []]);
  });

  it("a tab active in an unfocused window, or in a window that is not the last focused, is nobody's: it is replaced", async () => {
    const unfocused = fakeChrome([{ id: 9, url: CAPTCHA, pinned: true, active: true }]);
    unfocused.windowFocused = false;
    const page = chromePageDriver(unfocused, recordingWait(), clockAt());
    await page.prepare();
    expect(await page.replaceTab()).not.toBeNull();
    expect(unfocused.removed).toEqual([9]);
    const elsewhere = fakeChrome([{ id: 9, url: CAPTCHA, pinned: true, active: true, windowId: 2 }]);
    const other = chromePageDriver(elsewhere, recordingWait(), clockAt());
    await other.prepare();
    expect(await other.replaceTab()).not.toBeNull();
  });

  it("spares one tab for 10 minutes from when it was first spared, then treats it as unattended, also after a worker restart", async () => {
    const clock = clockAt();
    const chrome = fakeChrome([{ id: 9, url: CAPTCHA, pinned: true, active: true }]);
    const page = chromePageDriver(chrome, recordingWait(), clock);
    await page.prepare();
    expect(await page.replaceTab()).toBeNull();
    clock.advance(SPARE_TAB_MAX_MS - 1);
    const restarted = chromePageDriver(chrome, recordingWait(), clock);
    await restarted.prepare();
    expect(await restarted.replaceTab()).toBeNull();
    clock.advance(1);
    expect(await restarted.replaceTab()).not.toBeNull();
    expect(chrome.removed).toEqual([9]);
  });

  it("the owner leaving the tab ends its time: back on it, it is spared afresh", async () => {
    const clock = clockAt();
    const chrome = fakeChrome([{ id: 9, url: CAPTCHA, pinned: true, active: true }]);
    const page = chromePageDriver(chrome, recordingWait(), clock);
    await page.prepare();
    expect(await page.replaceTab()).toBeNull();
    clock.advance(SPARE_TAB_MAX_MS - 1);
    chrome.windowFocused = false;
    await chromePageDriver(fakeChromeSharing(chrome), recordingWait(), clock).prepare();
    chrome.windowFocused = true;
    clock.advance(1);
    expect(await page.replaceTab()).toBeNull();
  });

  it("shares the 5-minute cooldown with a frozen page, and a browser that opens no tab is no replacement", async () => {
    const clock = clockAt();
    const chrome = fakeChrome([{ id: 9, url: CUSTOM_LINK_URL, pinned: true }]);
    const page = chromePageDriver(chrome, recordingWait(), clock);
    await page.prepare();
    expect(await page.replaceTab()).not.toBeNull();
    clock.advance(REPLACE_TAB_EVERY_MS - 1);
    expect(await page.replaceTab()).toBeNull();
    clock.advance(1);
    Object.assign(chrome.tabs, { create: () => Promise.reject(new Error("no")) });
    expect(await page.replaceTab()).toBeNull();
    expect(page.replacements()).toBe(1);
  });
});

describe("D68: the bridge tells the server when a verification page is left", () => {
  const VERIFY = "https://affiliate.shopee.vn/verify/traffic?x=1";
  const posted = () => {
    const calls: string[] = [];
    const fetch: Fetch = async (url, init) => {
      calls.push(`${init.method} ${url}`);
      if (url.endsWith("/next")) return new Promise(() => undefined);
      return { status: 200, json: async () => ({ cleared: true }) };
    };
    return { calls, fetch };
  };
  const CLEARED = "POST http://127.0.0.1:9081/internal/bridge/verification-cleared";
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  function installed(store: Record<string, unknown> = {}, fetch = posted()) {
    const chrome = fakeChrome([], { ...SETTINGS, ...store });
    bridgeService({ chrome, fetch: fetch.fetch, follow: NO_FOLLOW, wait: recordingWait(), randomBytes: SEQUENCE, log: () => undefined }).install();
    const moved = async (tabId: number, url?: string) => {
      for (const fire of chrome.listeners["tabs.onUpdated"] ?? []) (fire as (id: number, change: { url?: string }, tab: object) => void)(tabId, url === undefined ? {} : { url }, {});
      await flush();
    };
    const fired = async (name: string, ...args: unknown[]) => {
      for (const fire of chrome.listeners[name] ?? []) (fire as (...a: unknown[]) => void)(...args);
      await flush();
    };
    return { chrome, moved, fired, sent: () => fetch.calls.filter((c) => c === CLEARED) };
  }

  it("a non-Shopee address holding /verify/ is not remembered", async () => {
    const t = installed();
    await t.moved(50, "https://mail.example.com/verify/abc");
    expect(t.chrome.store[VERIFICATION_TABS_KEY]).toBeUndefined();
    await t.moved(50, CUSTOM_LINK_URL);
    expect(t.sent()).toEqual([]);
  });

  it("a job's own move off a verification page tells the server nothing, and a job ending on one leaves its tab remembered for the owner's clear", async () => {
    const job = { ticket: "0".repeat(32), kind: "link", sourceUrl: "https://shopee.vn/Ao-i.11001.22001", subId1: "DEV1000000000000000001", subId2: "DEV26110100001", timeoutMs: 90_000 };
    const calls: string[] = [];
    let handed = false;
    const fetch: Fetch = async (url, init) => {
      calls.push(`${init.method} ${url}`);
      if (url.endsWith("/next")) {
        if (handed) return new Promise(() => undefined);
        handed = true;
        return { status: 200, json: async () => job };
      }
      return { status: 200, json: async () => ({ accepted: true, cleared: false }) };
    };
    const chrome = fakeChrome([{ id: 9, url: VERIFY, pinned: true }], { ...SETTINGS, [VERIFICATION_TABS_KEY]: [9] });
    chrome.landsAt = VERIFY;
    const move = (id: number, url: string) => {
      for (const fire of chrome.listeners["tabs.onUpdated"] ?? []) (fire as (i: number, change: { url?: string }, tab: object) => void)(id, { url }, {});
    };
    // The job takes the tab to the form: it reaches the custom link page, and Shopee sends it back.
    Object.assign(chrome.tabs, {
      update: async (tabId: number, properties: { url?: string }) => {
        if (properties.url !== undefined) {
          move(tabId, properties.url);
          move(tabId, VERIFY);
        }
        return chrome.openTabs.find((t) => t.id === tabId);
      },
    });
    Object.assign(chrome, { scripting: { executeScript: async () => [{ result: { href: VERIFY, ready: false, passwordBox: false } }] } });
    bridgeService({ chrome, fetch, follow: NO_FOLLOW, wait: recordingWait(), randomBytes: SEQUENCE, log: () => undefined }).install();
    for (let i = 0; i < 40 && !calls.some((c) => c.endsWith("/results")); i++) await flush();
    await flush();
    expect(calls).toContain("POST http://127.0.0.1:9081/internal/bridge/results");
    expect(calls.filter((c) => c === CLEARED)).toEqual([]);
    expect(chrome.store[VERIFICATION_TABS_KEY]).toEqual([101]);
    // The job is over: the owner's clear in the tab it ended on is told.
    move(101, CUSTOM_LINK_URL);
    await flush();
    expect(calls.filter((c) => c === CLEARED)).toEqual([CLEARED]);
  });

  it("posts once when a tab goes from a verification page to a Shopee page, whatever the tab", async () => {
    const t = installed();
    await t.moved(50, VERIFY);
    expect(t.chrome.store[VERIFICATION_TABS_KEY]).toEqual([50]);
    await t.moved(50, "https://shopee.vn/verify/traffic/error");
    expect(t.sent()).toEqual([]);
    await t.moved(50);
    expect(t.sent()).toEqual([]);
    await t.moved(50, CUSTOM_LINK_URL);
    await t.moved(50, "https://affiliate.shopee.vn/offer/product_offer");
    expect(t.sent()).toEqual([CLEARED]);
    expect(t.chrome.store[VERIFICATION_TABS_KEY]).toEqual([]);
  });

  it("two quick changes in a row post once and lose no tab", async () => {
    const t = installed();
    for (const fire of t.chrome.listeners["tabs.onUpdated"] ?? []) {
      const moved = fire as (id: number, change: { url?: string }, tab: object) => void;
      moved(50, { url: VERIFY }, {});
      moved(51, { url: VERIFY }, {});
      moved(50, { url: CUSTOM_LINK_URL }, {});
      moved(50, { url: CUSTOM_LINK_URL }, {});
    }
    await flush();
    expect(t.sent()).toEqual([CLEARED]);
    expect(t.chrome.store[VERIFICATION_TABS_KEY]).toEqual([51]);
  });

  it("a restarted worker still sees it, from the stored state", async () => {
    const t = installed({ [VERIFICATION_TABS_KEY]: [50] });
    await t.moved(50, CUSTOM_LINK_URL);
    expect(t.sent()).toEqual([CLEARED]);
  });

  it("nothing is posted for a tab that was on no verification page, that went to the login page or off Shopee, or that was closed", async () => {
    const t = installed();
    await t.moved(1, CUSTOM_LINK_URL);
    await t.moved(2, VERIFY);
    await t.moved(2, "https://shopee.vn/buyer/login?next=x");
    await t.moved(3, VERIFY);
    await t.moved(3, "https://mail.example.com/");
    await t.moved(3, CUSTOM_LINK_URL);
    await t.moved(4, VERIFY);
    await t.fired("tabs.onRemoved", 4, {});
    await t.moved(4, CUSTOM_LINK_URL);
    expect(t.sent()).toEqual([]);
    expect(t.chrome.store[VERIFICATION_TABS_KEY]).toEqual([2]);
  });

  it("tab ids mean nothing after a browser start: the stored ones are forgotten", async () => {
    const t = installed({ [VERIFICATION_TABS_KEY]: [50] });
    await t.fired("runtime.onStartup");
    await t.moved(50, CUSTOM_LINK_URL);
    expect(t.sent()).toEqual([]);
  });

  it("a post that fails is not retried and breaks nothing: the hold ends by itself", async () => {
    const calls: string[] = [];
    const fetch: Fetch = async (url) => {
      calls.push(url);
      if (url.endsWith("/next")) return new Promise(() => undefined);
      throw new TypeError("fetch failed");
    };
    const t = installed({}, { calls, fetch });
    await t.moved(50, VERIFY);
    await t.moved(50, CUSTOM_LINK_URL);
    await t.moved(50, "https://affiliate.shopee.vn/offer/product_offer");
    expect(calls.filter((c) => c.endsWith("/verification-cleared"))).toHaveLength(1);
    expect(t.chrome.store[VERIFICATION_TABS_KEY]).toEqual([]);
  });
});
