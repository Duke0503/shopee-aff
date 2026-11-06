/**
 * Sees a captcha cleared (D68). Chrome already tells the worker every address change, so this asks
 * Shopee nothing (D8): a tab on a `/verify/` page is remembered in the profile's storage, because the
 * service worker may be stopped while the owner solves it, and when that tab moves on to a Shopee page
 * that is not a verification or login page the server is told, once. A tab that was closed or left
 * Shopee cleared nothing and is only forgotten. A tab on the login page stays remembered: the page
 * after it still says the verification is over, and a lost login is the server's own state. A move
 * made while a job is in hand is the bridge's own navigation, so it tells the server nothing; a job
 * that ends on a verification page leaves its tab remembered. Steps run one at a time, so two quick
 * changes cannot lose an entry or tell the server twice.
 */
import type { ChromeApi } from "./chrome-api.types";
import { BRIDGE_TAB_SITE, pageBlock } from "./shopee-page";

/** Where the ids of the tabs on a verification page are kept. */
export const VERIFICATION_TABS_KEY = "verificationTabs";

export interface VerificationWatch {
  tabMoved(tabId: number, url: string): Promise<void>;
  tabClosed(tabId: number): Promise<void>;
  /** Tab ids restart with the browser, so the remembered ones mean nothing after that. */
  forgetAll(): Promise<void>;
  jobStarted(): void;
  /** The job is over; `url` is where its tab ended, if it can be told. */
  jobEnded(tabId: number | null, url: string | null): Promise<void>;
}

export function verificationWatch(chrome: ChromeApi, tellCleared: () => Promise<void>): VerificationWatch {
  let line: Promise<void> = Promise.resolve();
  let working = false;
  const inLine = (step: () => Promise<void>): Promise<void> => {
    line = line.then(step).catch(() => undefined);
    return line;
  };
  const remembered = async (): Promise<number[]> => {
    const value = (await chrome.storage.local.get([VERIFICATION_TABS_KEY]))[VERIFICATION_TABS_KEY];
    return Array.isArray(value) ? value.filter((id): id is number => typeof id === "number") : [];
  };
  const remember = (ids: number[]): Promise<void> => chrome.storage.local.set({ [VERIFICATION_TABS_KEY]: ids });
  const forget = async (tabId: number): Promise<boolean> => {
    const ids = await remembered();
    if (!ids.includes(tabId)) return false;
    await remember(ids.filter((id) => id !== tabId));
    return true;
  };
  const onVerification = (url: string): boolean => BRIDGE_TAB_SITE.test(url) && pageBlock(url, false) === "captcha";
  const add = async (tabId: number): Promise<void> => {
    const ids = await remembered();
    if (!ids.includes(tabId)) await remember([...ids, tabId]);
  };
  return {
    tabMoved: (tabId, url) => {
      // Read now, not in the step's turn: the move belongs to the job in hand when it happened.
      const inJob = working;
      return inLine(async () => {
        if (onVerification(url)) await add(tabId);
        else if (!BRIDGE_TAB_SITE.test(url)) await forget(tabId);
        else if (pageBlock(url, false) === null && (await forget(tabId)) && !inJob) await tellCleared();
      });
    },
    tabClosed: (tabId) => inLine(async () => void (await forget(tabId))),
    forgetAll: () => inLine(() => remember([])),
    jobStarted: () => {
      working = true;
    },
    jobEnded: (tabId, url) => {
      working = false;
      return inLine(async () => {
        if (tabId !== null && url !== null && onVerification(url)) await add(tabId);
      });
    },
  };
}
