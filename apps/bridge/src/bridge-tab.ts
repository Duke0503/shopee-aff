/**
 * The one affiliate tab the bridge works in. It is found again by address after a browser or
 * extension restart (or opened on the custom link page), pinned, and marked not discardable, so
 * Chrome's memory saver never discards it and its page keeps answering (Story 5.3 AC5). A tab Chrome
 * discarded anyway is reloaded before use. Waiting for a page load is done here, in the service
 * worker, by asking the tab's status between short pauses; never inside the page.
 *
 * A page that stops answering is replaced (the live system's fix of 19 Oct 2026, read as
 * reference): Shopee showed a captcha, the tab froze, every script hung and nothing could say
 * "captcha". A page script that has not answered within `SCRIPT_ANSWER_MS` means a frozen page:
 * the custom link page is opened in a fresh tab, the frozen tab is closed, and the job is answered
 * with what the fresh tab's address shows (a verification or login page), read from the tab list
 * because no script runs in the frozen page. A tab that simply froze is answered `page_not_ready`;
 * the next job works in the fresh tab. At most once every `REPLACE_TAB_EVERY_MS`, so a page that
 * keeps freezing cannot make the bridge open and close tabs in a loop.
 */
import type { BridgeFailure } from "@cashback/contracts";
import { systemClock, toMs, type Clock } from "@cashback/core";

import type { ChromeApi, ChromeTab } from "./chrome-api.types";
import { AFFILIATE_TAB_PATTERN, CUSTOM_LINK_URL, pageBlock } from "./shopee-page";

export type Wait = (ms: number) => Promise<void>;

/** What a job needs from the tab; the tests hand in a fake. */
export interface PageDriver {
  /** Finds or opens the bridge tab and keeps it alive. */
  prepare(): Promise<void>;
  /** The tab's current address. */
  href(): Promise<string>;
  /** Loads `url` in the tab and waits for the load to finish, at most `LOAD_WAIT_MS`. */
  open(url: string): Promise<void>;
  /**
   * Runs one page script in the tab and returns its answer; one not answered within `answerMs`
   * (default `SCRIPT_ANSWER_MS`) means a frozen page.
   */
  run<A, R>(func: (arg: A) => R, arg: A, answerMs?: number): Promise<R>;
}

export const LOAD_WAIT_MS = 30_000;
const LOAD_POLL_MS = 250;
/** A page script looks once and returns at once; one not answered in this long is a frozen page. */
export const SCRIPT_ANSWER_MS = 20_000;
export const REPLACE_TAB_EVERY_MS = 5 * 60_000;

export class BridgeTabError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeTabError";
  }
}

/** The page answered with a state that ends the job: a verification or login page, or no page (a frozen tab). */
export class Blocked extends Error {
  constructor(readonly reason: BridgeFailure) {
    super(reason);
  }
}

const FROZEN = Symbol("frozen");

/** Pins the tab and turns automatic discarding off; called before every job and by the keep-alive alarm. */
export async function keepAlive(chrome: ChromeApi, tabId: number): Promise<void> {
  await chrome.tabs.update(tabId, { pinned: true, autoDiscardable: false });
}

async function findTab(chrome: ChromeApi, known: number | null): Promise<ChromeTab | null> {
  if (known !== null) {
    const tab = await chrome.tabs.get(known).catch(() => null);
    if (tab?.id !== undefined) return tab;
  }
  const [open] = await chrome.tabs.query({ url: AFFILIATE_TAB_PATTERN });
  return open?.id !== undefined ? open : null;
}

async function settleTab(chrome: ChromeApi, wait: Wait, id: number): Promise<void> {
  for (let waited = 0; waited < LOAD_WAIT_MS; waited += LOAD_POLL_MS) {
    if ((await chrome.tabs.get(id)).status === "complete") return;
    await wait(LOAD_POLL_MS);
  }
  throw new BridgeTabError("page load timed out");
}

/**
 * Opens the custom link page in a fresh tab, closes the frozen one and says what the fresh tab's
 * address shows (only tab-level calls: no script runs in the frozen page). Returns the fresh tab
 * and its block, or null when the browser would not open one.
 */
async function replaceFrozenTab(chrome: ChromeApi, wait: Wait, frozen: number): Promise<{ id: number; shows: BridgeFailure | null } | null> {
  try {
    const fresh = await chrome.tabs.create({ url: CUSTOM_LINK_URL, pinned: true, active: false });
    if (fresh.id === undefined) return null;
    await chrome.tabs.remove(frozen).catch(() => undefined);
    await keepAlive(chrome, fresh.id);
    await settleTab(chrome, wait, fresh.id).catch(() => undefined);
    return { id: fresh.id, shows: pageBlock((await chrome.tabs.get(fresh.id)).url ?? "", false) };
  } catch {
    return null;
  }
}

export function chromePageDriver(chrome: ChromeApi, wait: Wait, clock: Clock = systemClock): PageDriver & { tabId(): number | null } {
  let tabId: number | null = null;
  let replacedAtMs: number | null = null;
  const current = (): number => {
    if (tabId === null) throw new BridgeTabError("no bridge tab");
    return tabId;
  };
  const settle = (id: number): Promise<void> => settleTab(chrome, wait, id);
  /** What the job answers for a frozen page: the fresh tab's block, else `page_not_ready` (also inside the cooldown). */
  const frozenAnswer = async (frozen: number): Promise<BridgeFailure> => {
    const now = toMs(clock.now());
    if (replacedAtMs !== null && now - replacedAtMs < REPLACE_TAB_EVERY_MS) return "page_not_ready";
    replacedAtMs = now;
    const fresh = await replaceFrozenTab(chrome, wait, frozen);
    if (fresh !== null) tabId = fresh.id;
    return fresh?.shows ?? "page_not_ready";
  };
  return {
    tabId: () => tabId,
    async prepare() {
      const found = await findTab(chrome, tabId);
      const tab = found ?? (await chrome.tabs.create({ url: CUSTOM_LINK_URL, pinned: true, active: false }));
      if (tab.id === undefined) throw new BridgeTabError("the bridge tab has no id");
      tabId = tab.id;
      await keepAlive(chrome, tab.id);
      if (tab.discarded === true) await chrome.tabs.reload(tab.id);
      await settle(tab.id);
    },
    async href() {
      return (await chrome.tabs.get(current())).url ?? "";
    },
    async open(url) {
      const id = current();
      await chrome.tabs.update(id, { url });
      await wait(LOAD_POLL_MS);
      await settle(id);
    },
    async run(func, arg, answerMs = SCRIPT_ANSWER_MS) {
      const id = current();
      const answer = chrome.scripting.executeScript({ target: { tabId: id }, world: "MAIN", func, args: [arg] });
      const looked = await Promise.race([answer, wait(answerMs).then((): typeof FROZEN => FROZEN)]);
      if (looked === FROZEN) throw new Blocked(await frozenAnswer(id));
      const [first] = looked as Awaited<typeof answer>;
      if (first === undefined || !("result" in first)) throw new BridgeTabError("the page script returned nothing");
      return first.result as Awaited<ReturnType<typeof func>>;
    },
  };
}
