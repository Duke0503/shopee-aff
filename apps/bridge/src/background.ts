/**
 * The extension's module service worker (Manifest V3): the real Chrome API, the worker's own
 * `fetch` and timers. Timers here run in the service worker, never in a page, so a hidden
 * affiliate tab cannot slow them down. Log lines carry ids and outcomes only, never a token or a link.
 */
import { bridgeService } from "./bridge-service";
import type { ChromeApi } from "./chrome-api.types";
import type { Fetch } from "./server-client";

declare const chrome: ChromeApi;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

bridgeService({
  chrome,
  fetch: fetch as unknown as Fetch,
  wait,
  randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
  log: (event, detail) => console.info(`[cashback-bridge] ${event}`, detail ?? {}),
}).install();
