/**
 * Fakes for the extension's tests: a custom link page that answers the page scripts by identity,
 * a Chrome API that records tab calls, and a wait that never sleeps. Nothing here opens a network
 * connection or a browser.
 */
import type { PageDriver, Wait } from "../src/bridge-tab";
import type { ChromeApi, ChromeTab } from "../src/chrome-api.types";
import { fillForm, pressSubmit, readPage, readResult, readResultBox, type FillInput, type ResultLook } from "../src/page-scripts";
import { CUSTOM_LINK_URL } from "../src/shopee-page";

export interface FakePageState {
  href: string;
  formReady: boolean;
  passwordBox: boolean;
  result: string;
  /** What the result box shows this many looks after the submit, or a page error. */
  answer: { afterLooks: number; link?: string; error?: string } | null;
  buttonMissing?: boolean;
  /** Reloads it takes before the form appears. */
  formAfterOpens?: number;
  /** Where Shopee sends every page load (a verification or login page). */
  stuckAt?: string;
}

export function fakePage(over: Partial<FakePageState> = {}): PageDriver & { state: FakePageState; calls: string[]; filled: FillInput[]; waited: number[] } {
  const state: FakePageState = { href: CUSTOM_LINK_URL, formReady: true, passwordBox: false, result: "", answer: { afterLooks: 2, link: "https://s.shopee.vn/New1" }, ...over };
  const calls: string[] = [];
  const filled: FillInput[] = [];
  let looks = -1;
  let opens = 0;
  const answerLook = (previous: string): ResultLook => {
    if (looks < 0 || state.answer === null) return { state: "waiting" };
    looks++;
    if (looks < state.answer.afterLooks) return { state: "waiting" };
    if (state.answer.error !== undefined) return { state: "error", message: state.answer.error };
    state.result = state.answer.link ?? "";
    // As the real readResult: only a value different from the one before the submit counts.
    return state.result === previous ? { state: "waiting" } : { state: "link", links: state.result.split("\n") };
  };
  return {
    state,
    calls,
    filled,
    waited: [],
    prepare: async () => void calls.push("prepare"),
    href: async () => state.href,
    open: async (url) => {
      calls.push(`open ${url}`);
      opens++;
      state.href = state.stuckAt ?? url;
      if (state.formAfterOpens !== undefined && opens >= state.formAfterOpens) state.formReady = true;
    },
    run: async <A, R>(func: (arg: A) => R, arg: A): Promise<R> => {
      const answer = (value: unknown): R => value as R;
      if (func === (readPage as unknown)) return answer({ href: state.href, ready: state.formReady, passwordBox: state.passwordBox });
      if (func === (readResultBox as unknown)) return answer(state.result);
      if (func === (fillForm as unknown)) {
        calls.push("fill");
        filled.push(arg as FillInput);
        return answer(state.formReady ? { ok: true } : { ok: false, why: "source box not found" });
      }
      if (func === (pressSubmit as unknown)) {
        calls.push("submit");
        looks = 0;
        return answer(state.buttonMissing ? { ok: false, why: "submit button not found" } : { ok: true });
      }
      if (func === (readResult as unknown)) return answer(answerLook((arg as { previous: string }).previous));
      throw new Error("unknown page script");
    },
  };
}

/** A wait that records how long it was asked to wait and returns at once. */
export function recordingWait(): Wait & { total(): number; calls: number[] } {
  const calls: number[] = [];
  const wait = (async (ms: number) => void calls.push(ms)) as Wait & { total(): number; calls: number[] };
  wait.calls = calls;
  wait.total = () => calls.reduce((a, b) => a + b, 0);
  return wait;
}

export interface FakeChrome extends ChromeApi {
  readonly tabs: ChromeApi["tabs"];
  readonly updates: { tabId: number; properties: Record<string, unknown> }[];
  readonly created: Record<string, unknown>[];
  readonly reloads: number[];
  readonly store: Record<string, unknown>;
  readonly listeners: Record<string, ((...args: never[]) => void)[]>;
  readonly alarmsCreated: { name: string; periodInMinutes: number }[];
  openTabs: ChromeTab[];
}

export function fakeChrome(openTabs: ChromeTab[] = [], store: Record<string, unknown> = {}): FakeChrome {
  const updates: FakeChrome["updates"] = [];
  const created: Record<string, unknown>[] = [];
  const reloads: number[] = [];
  const listeners: FakeChrome["listeners"] = {};
  const alarmsCreated: FakeChrome["alarmsCreated"] = [];
  const event = (name: string) => ({ addListener: (fn: (...args: never[]) => void) => void (listeners[name] ??= []).push(fn) });
  const self: FakeChrome = {
    openTabs,
    updates,
    created,
    reloads,
    store,
    listeners,
    alarmsCreated,
    tabs: {
      query: async () => self.openTabs.filter((t) => (t.url ?? "").startsWith("https://affiliate.shopee.vn/")),
      get: async (id) => {
        const tab = self.openTabs.find((t) => t.id === id);
        if (tab === undefined) throw new Error("no tab");
        return { ...tab, status: "complete" };
      },
      create: async (properties) => {
        created.push(properties);
        const tab = { id: 100 + created.length, url: properties.url, status: "complete" };
        self.openTabs.push(tab);
        return tab;
      },
      update: async (tabId, properties) => {
        updates.push({ tabId, properties });
        return self.openTabs.find((t) => t.id === tabId);
      },
      reload: async (tabId) => void reloads.push(tabId),
    },
    scripting: { executeScript: async () => [] },
    storage: {
      local: { get: async (keys) => Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]])), set: async (items) => void Object.assign(store, items) },
      onChanged: event("storage.onChanged"),
    },
    alarms: { create: (name, info) => void alarmsCreated.push({ name, ...info }), onAlarm: event("alarms.onAlarm") },
    runtime: { onStartup: event("runtime.onStartup"), onInstalled: event("runtime.onInstalled"), openOptionsPage: async () => undefined },
    action: { onClicked: event("action.onClicked") },
  };
  return self;
}
