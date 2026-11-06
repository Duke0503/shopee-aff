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
 *
 * The service worker is stopped when idle and forgets everything in memory, while a lookup or a short
 * link leaves the tab on shopee.vn rather than the affiliate site. So the tab's id is kept in the
 * profile's storage, a pinned tab on a Shopee site is taken as the bridge's, and any other pinned
 * Shopee tab (one opened before this fix) is closed, and so is any other custom link tab, pinned or
 * not: the bridge keeps exactly one tab. Other unpinned Shopee tabs are never touched.
 *
 * `replaceTab` does the same replacement for a job that met a captcha, so the job gets one more look
 * in a fresh tab before it is reported (D68); it shares the cooldown above. The active tab of a
 * window that has the focus is not closed by any of these, for at most `SPARE_TAB_MAX_MS`: the owner
 * may be solving the captcha in it, but a tab left there must not keep a frozen bridge tab forever.
 */
import type { BridgeFailure } from "@cashback/contracts";
import { systemClock, toMs, type Clock } from "@cashback/core";

import type { ChromeApi, ChromeTab } from "./chrome-api.types";
import { AFFILIATE_TAB_PATTERN, BRIDGE_TAB_SITE, CUSTOM_LINK_TAB_PATTERN, CUSTOM_LINK_URL, pageAddress, pageBlock } from "./shopee-page";

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
  /**
   * Opens a fresh tab, closes this one and says what the fresh tab's address shows. Null when it was
   * not replaced: the owner is on the tab, the cooldown runs, or the browser would not open one.
   */
  replaceTab(): Promise<FreshTab | null>;
  /** How many times the tab has been replaced, a frozen page's replacement included. */
  replacements(): number;
}

export interface FreshTab {
  readonly shows: BridgeFailure | null;
  /** The address that shows the block (D69). */
  readonly blockedAt?: string;
}

export const LOAD_WAIT_MS = 30_000;
const LOAD_POLL_MS = 250;
/** A page script looks once and returns at once; one not answered in this long is a frozen page. */
export const SCRIPT_ANSWER_MS = 20_000;
export const REPLACE_TAB_EVERY_MS = 5 * 60_000;
/** How long one tab is spared as the owner's, from when it was first spared; after that it counts as unattended. */
export const SPARE_TAB_MAX_MS = 10 * 60_000;

export class BridgeTabError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeTabError";
  }
}

/** The page answered with a state that ends the job: a verification or login page, or no page (a frozen tab). */
export class Blocked extends Error {
  constructor(
    readonly reason: BridgeFailure,
    /** The page that showed it, origin and path only (D69). */
    readonly blockedAt?: string,
  ) {
    super(reason);
  }
}

/** Ends the job when the page it looked at is a verification or login page, naming that page. */
export function throwIfBlocked(look: { href: string; passwordBox: boolean }): void {
  const block = pageBlock(look.href, look.passwordBox);
  if (block !== null) throw new Blocked(block, pageAddress(look.href));
}

/** The failed answer of a blocked job. */
export function blockedAnswer(blocked: Blocked): { outcome: "failed"; reason: BridgeFailure; blockedAt?: string } {
  return { outcome: "failed", reason: blocked.reason, ...(blocked.blockedAt === undefined ? {} : { blockedAt: blocked.blockedAt }) };
}

/** What a tab's address shows, read from the tab list: no script runs in a frozen page. */
function shownBy(href: string): FreshTab {
  const shows = pageBlock(href, false);
  const blockedAt = shows === null ? undefined : pageAddress(href);
  return blockedAt === undefined ? { shows } : { shows, blockedAt };
}

const FROZEN = Symbol("frozen");

/** Pins the tab and turns automatic discarding off; called before every job and by the keep-alive alarm. */
export async function keepAlive(chrome: ChromeApi, tabId: number): Promise<void> {
  await chrome.tabs.update(tabId, { pinned: true, autoDiscardable: false });
}

/** Where the bridge tab's id is kept, so a restarted service worker finds the same tab. */
export const TAB_ID_KEY = "bridgeTabId";
/** Which tab is being spared and since when, so a restarted service worker does not start its time again. */
export const SPARED_TAB_KEY = "sparedTab";

const onBridgeSite = (tab: ChromeTab): boolean => BRIDGE_TAB_SITE.test(tab.url ?? "");

async function storedTabId(chrome: ChromeApi): Promise<number | null> {
  const value = (await chrome.storage.local.get([TAB_ID_KEY]).catch(() => ({}) as Record<string, unknown>))[TAB_ID_KEY];
  return typeof value === "number" ? value : null;
}

async function rememberTab(chrome: ChromeApi, tabId: number): Promise<void> {
  await chrome.storage.local.set({ [TAB_ID_KEY]: tabId }).catch(() => undefined);
}

/** The known tab, else the stored one, else a pinned Shopee tab, else any affiliate tab; a known id must still be on a Shopee site. */
async function findTab(chrome: ChromeApi, known: number | null): Promise<ChromeTab | null> {
  for (const id of [known, await storedTabId(chrome)]) {
    if (id === null) continue;
    const tab = await chrome.tabs.get(id).catch(() => null);
    if (tab?.id !== undefined && onBridgeSite(tab)) return tab;
  }
  const pinned = (await chrome.tabs.query({ pinned: true })).filter(onBridgeSite);
  if (pinned[0]?.id !== undefined) return pinned[0];
  const [open] = await chrome.tabs.query({ url: AFFILIATE_TAB_PATTERN });
  return open?.id !== undefined ? open : null;
}

/** The active tab of the window that has the focus; null when no window has it (Chrome in the background, nobody there). */
async function frontTabId(chrome: ChromeApi): Promise<number | null> {
  const window = await chrome.windows.getLastFocused({ populate: true }).catch(() => null);
  return window?.focused === true ? (window.tabs?.find((t) => t.active === true)?.id ?? null) : null;
}

async function sparedTab(chrome: ChromeApi): Promise<{ id: number; sinceMs: number } | null> {
  const value = (await chrome.storage.local.get([SPARED_TAB_KEY]).catch(() => ({}) as Record<string, unknown>))[SPARED_TAB_KEY] as { id?: unknown; sinceMs?: unknown } | null | undefined;
  return typeof value?.id === "number" && typeof value.sinceMs === "number" ? { id: value.id, sinceMs: value.sinceMs } : null;
}

/** True when the tab is the owner's: in front of a focused window, and for less than `SPARE_TAB_MAX_MS` since it was first spared. */
async function ownerOn(chrome: ChromeApi, clock: Clock, tabId: number): Promise<boolean> {
  const front = await frontTabId(chrome);
  const spared = await sparedTab(chrome);
  if (spared !== null && spared.id !== front) await chrome.storage.local.set({ [SPARED_TAB_KEY]: null }).catch(() => undefined);
  if (front !== tabId) return false;
  const now = toMs(clock.now());
  if (spared?.id === tabId) return now - spared.sinceMs < SPARE_TAB_MAX_MS;
  await chrome.storage.local.set({ [SPARED_TAB_KEY]: { id: tabId, sinceMs: now } }).catch(() => undefined);
  return true;
}

/** Closes every other pinned Shopee tab (left by an earlier restart) and every other custom link tab, except the one the owner is on. Any other unpinned tab is never touched. */
async function closeExtraTabs(chrome: ChromeApi, clock: Clock, keep: number): Promise<void> {
  const pinned = (await chrome.tabs.query({ pinned: true })).filter(onBridgeSite);
  const links = await chrome.tabs.query({ url: CUSTOM_LINK_TAB_PATTERN });
  const extra = new Set([...pinned, ...links].flatMap((t) => (t.id === undefined || t.id === keep ? [] : [t.id])));
  for (const id of extra) {
    if (!(await ownerOn(chrome, clock, id))) await chrome.tabs.remove(id).catch(() => undefined);
  }
}

async function settleTab(chrome: ChromeApi, wait: Wait, id: number): Promise<void> {
  for (let waited = 0; waited < LOAD_WAIT_MS; waited += LOAD_POLL_MS) {
    if ((await chrome.tabs.get(id)).status === "complete") return;
    await wait(LOAD_POLL_MS);
  }
  throw new BridgeTabError("page load timed out");
}

/**
 * Opens the custom link page in a fresh tab, closes the frozen or blocked one and says what the fresh
 * tab's address shows (only tab-level calls: no script runs in a frozen page). Returns the fresh tab
 * and its block, or null when the browser would not open one.
 */
async function replaceFrozenTab(chrome: ChromeApi, wait: Wait, frozen: number): Promise<(FreshTab & { id: number }) | null> {
  try {
    const fresh = await chrome.tabs.create({ url: CUSTOM_LINK_URL, pinned: true, active: false });
    if (fresh.id === undefined) return null;
    await chrome.tabs.remove(frozen).catch(() => undefined);
    await keepAlive(chrome, fresh.id);
    await settleTab(chrome, wait, fresh.id).catch(() => undefined);
    return { id: fresh.id, ...shownBy((await chrome.tabs.get(fresh.id)).url ?? "") };
  } catch {
    return null;
  }
}

/** Replaces a tab at most once every `REPLACE_TAB_EVERY_MS`, whichever asks, and counts it. */
function tabReplacer(chrome: ChromeApi, wait: Wait, clock: Clock): { replace(old: number): Promise<(FreshTab & { id: number }) | null>; count(): number } {
  let replacedAtMs: number | null = null;
  let count = 0;
  return {
    count: () => count,
    async replace(old) {
      const now = toMs(clock.now());
      if (replacedAtMs !== null && now - replacedAtMs < REPLACE_TAB_EVERY_MS) return null;
      replacedAtMs = now;
      const fresh = await replaceFrozenTab(chrome, wait, old);
      if (fresh === null) return null;
      count++;
      await rememberTab(chrome, fresh.id);
      return fresh;
    },
  };
}

/** What the job answers for a frozen page: the fresh tab's block, else `page_not_ready` (also inside the cooldown). The owner's tab stays, and its address answers. */
async function frozenAnswer(chrome: ChromeApi, clock: Clock, frozen: number, replace: (old: number) => Promise<FreshTab | null>): Promise<Blocked> {
  if (await ownerOn(chrome, clock, frozen)) {
    const tab = await chrome.tabs.get(frozen).catch(() => null);
    const seen = shownBy(tab?.url ?? "");
    return new Blocked(seen.shows ?? "page_not_ready", seen.blockedAt);
  }
  const fresh = await replace(frozen);
  return new Blocked(fresh?.shows ?? "page_not_ready", fresh?.blockedAt);
}

export function chromePageDriver(chrome: ChromeApi, wait: Wait, clock: Clock = systemClock): PageDriver & { tabId(): number | null } {
  let tabId: number | null = null;
  const replacer = tabReplacer(chrome, wait, clock);
  const current = (): number => {
    if (tabId === null) throw new BridgeTabError("no bridge tab");
    return tabId;
  };
  const settle = (id: number): Promise<void> => settleTab(chrome, wait, id);
  /** Replaces the tab unless the cooldown runs or the browser would not open one. */
  const replace = async (old: number): Promise<FreshTab | null> => {
    const fresh = await replacer.replace(old);
    if (fresh === null) return null;
    tabId = fresh.id;
    const { id: _id, ...shown } = fresh;
    return shown;
  };
  return {
    tabId: () => tabId,
    replacements: () => replacer.count(),
    async replaceTab() {
      if (tabId === null || (await ownerOn(chrome, clock, tabId))) return null;
      return replace(tabId);
    },
    async prepare() {
      const found = await findTab(chrome, tabId);
      const tab = found ?? (await chrome.tabs.create({ url: CUSTOM_LINK_URL, pinned: true, active: false }));
      if (tab.id === undefined) throw new BridgeTabError("the bridge tab has no id");
      if (tab.id !== tabId) await rememberTab(chrome, tab.id);
      tabId = tab.id;
      await closeExtraTabs(chrome, clock, tab.id);
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
      if (looked === FROZEN) throw await frozenAnswer(chrome, clock, id, replace);
      const [first] = looked as Awaited<typeof answer>;
      if (first === undefined || !("result" in first)) throw new BridgeTabError("the page script returned nothing");
      return first.result as Awaited<ReturnType<typeof func>>;
    },
  };
}
