/**
 * The one affiliate tab the bridge works in. It is found again by address after a browser or
 * extension restart (or opened on the custom link page), pinned, and marked not discardable, so
 * Chrome's memory saver never discards it and its page keeps answering (Story 5.3 AC5). A tab Chrome
 * discarded anyway is reloaded before use. Waiting for a page load is done here, in the service
 * worker, by asking the tab's status between short pauses; never inside the page.
 */
import type { ChromeApi, ChromeTab } from "./chrome-api.types";
import { AFFILIATE_TAB_PATTERN, CUSTOM_LINK_URL } from "./shopee-page";

export type Wait = (ms: number) => Promise<void>;

/** What a job needs from the tab; the tests hand in a fake. */
export interface PageDriver {
  /** Finds or opens the bridge tab and keeps it alive. */
  prepare(): Promise<void>;
  /** The tab's current address. */
  href(): Promise<string>;
  /** Loads `url` in the tab and waits for the load to finish, at most `LOAD_WAIT_MS`. */
  open(url: string): Promise<void>;
  /** Runs one page script in the tab and returns its answer. */
  run<A, R>(func: (arg: A) => R, arg: A): Promise<R>;
}

export const LOAD_WAIT_MS = 30_000;
const LOAD_POLL_MS = 250;

export class BridgeTabError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeTabError";
  }
}

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

export function chromePageDriver(chrome: ChromeApi, wait: Wait): PageDriver & { tabId(): number | null } {
  let tabId: number | null = null;
  const current = (): number => {
    if (tabId === null) throw new BridgeTabError("no bridge tab");
    return tabId;
  };
  const settle = async (id: number): Promise<void> => {
    for (let waited = 0; waited < LOAD_WAIT_MS; waited += LOAD_POLL_MS) {
      if ((await chrome.tabs.get(id)).status === "complete") return;
      await wait(LOAD_POLL_MS);
    }
    throw new BridgeTabError("page load timed out");
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
    async run(func, arg) {
      const [first] = await chrome.scripting.executeScript({ target: { tabId: current() }, world: "MAIN", func, args: [arg] });
      if (first === undefined || !("result" in first)) throw new BridgeTabError("the page script returned nothing");
      return first.result as Awaited<ReturnType<typeof func>>;
    },
  };
}
