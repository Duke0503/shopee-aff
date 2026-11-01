/**
 * Story 5.3 AC5 and restarts: the bridge tab is pinned and never discarded, found again after a
 * restart, reloaded when Chrome discarded it anyway, and the service starts the loop on every
 * wake-up event with at most one loop running. A fake Chrome API, no browser.
 */
import { BRIDGE_INSTANCE_HEADER } from "@cashback/contracts";
import { describe, expect, it } from "vitest";

import { bridgeService, KEEPALIVE_ALARM, KEEPALIVE_MINUTES } from "../src/bridge-service";
import { chromePageDriver } from "../src/bridge-tab";
import type { Fetch } from "../src/server-client";
import { CUSTOM_LINK_URL } from "../src/shopee-page";
import { fakeChrome, recordingWait } from "./fakes";

const SETTINGS = { serverUrl: "http://127.0.0.1:9081", token: "b".repeat(40) };
/** Not random: the bytes 0, 1, 2 ... so the instance id is known. */
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
    const service = bridgeService({ chrome, fetch, wait: recordingWait(), randomBytes: SEQUENCE, log: () => undefined }, stop);
    service.install();
    expect(Object.keys(chrome.listeners).sort()).toEqual(["action.onClicked", "alarms.onAlarm", "runtime.onInstalled", "runtime.onStartup", "storage.onChanged"]);
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
    const service = bridgeService({ chrome, fetch: idleFetch, wait: recordingWait(), randomBytes: SEQUENCE, log: () => undefined });
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
    const deps = { chrome, fetch, wait: recordingWait(), randomBytes: SEQUENCE, log: () => undefined };
    await bridgeService(deps, stop).start();
    const id = "000102030405060708090a0b0c0d0e0f";
    expect(chrome.store["instanceId"]).toBe(id);
    stop.stopped = false;
    // A restart makes a new worker with other random bytes; the stored id is kept.
    await bridgeService({ ...deps, randomBytes: (n: number) => new Uint8Array(n).fill(255) }, stop).start();
    expect(sent).toEqual([id, id]);
  });
});
