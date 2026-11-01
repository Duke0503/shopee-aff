/**
 * The extension's module service worker (Manifest V3): the real Chrome API, the worker's own
 * `fetch` and timers. Timers here run in the service worker, never in a page, so a hidden
 * affiliate tab cannot slow them down. Log lines carry ids and outcomes only, never a token or a link.
 */
import { bridgeService } from "./bridge-service";
import type { ChromeApi } from "./chrome-api.types";
import type { Fetch } from "./server-client";
import type { FollowLink } from "./short-link";

declare const chrome: ChromeApi;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A returned short link, followed by the browser to its target; no cookies, the body dropped (short-link.ts). */
const follow: FollowLink = async (url, signal) => {
  const answer = await fetch(url, { method: "GET", redirect: "follow", credentials: "omit", signal });
  await answer.body?.cancel().catch(() => undefined);
  return { finalUrl: answer.url };
};

bridgeService({
  chrome,
  fetch: fetch as unknown as Fetch,
  follow,
  wait,
  randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
  log: (event, detail) => console.info(`[cashback-bridge] ${event}`, detail ?? {}),
}).install();
