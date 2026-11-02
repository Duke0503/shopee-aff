/**
 * The third party's product lookup (addlivetag; owner decision 2026-11-02, restoring the live
 * order of 1819487): asked first for a product's price and rates, before the Shopee pages through
 * the bridge. It is a plain server-side GET to someone else's server, not a Shopee call, so D8 does
 * not apply. The request is the live `third_party_lookup.lookup` one: `GET product-data.php` with
 * `item_id` and `key` in the query and the key again in `X-API-Key`, 12 s timeout. Only the item
 * id is sent (the live code sent a URL only when it found no ids; a short link would need a Shopee
 * call to resolve, so such a request goes straight to the bridge).
 *
 * The key is in the request URL, so neither the URL nor an error message is ever returned or
 * logged: a failure is a reason code (`http_401`, `timeout`, `network`, `not_json`, or the
 * reading's miss). The provider marks its data for non-commercial use; the owner accepted that
 * (live module doc), and THIRD_PARTY_LOOKUP=off switches it off in one line.
 */
import type { HttpGet } from "./accesstrade-api.adapter";
import { fetchGet } from "./accesstrade-api.adapter";
import { readThirdPartyAnswer, type ThirdPartyFacts, type ThirdPartyMiss } from "./domain/third-party-product";

export const ADDLIVETAG_API_URL = "https://data.addlivetag.com/product-data/product-data.php";
/** The live TIMEOUT (12.0 s), request and body together. */
export const ADDLIVETAG_TIMEOUT_MS = 12_000;

export type ThirdPartyLookupAnswer = { readonly ok: true; readonly facts: ThirdPartyFacts } | { readonly ok: false; readonly reason: ThirdPartyMiss | ThirdPartyFailure };
export type ThirdPartyFailure = "timeout" | "network" | "not_json" | "aborted" | `http_${number}`;

/** The first source of a product lookup's facts; never throws. */
export interface ThirdPartyLookup {
  lookup(itemId: string, signal: AbortSignal): Promise<ThirdPartyLookupAnswer>;
}

export interface AddlivetagOptions {
  readonly apiKey: string;
  readonly get?: HttpGet;
  readonly timeoutMs?: number;
}

function failureOf(error: unknown, signal: AbortSignal, timeout: AbortSignal): ThirdPartyFailure {
  if (signal.aborted) return "aborted";
  if (timeout.aborted) return "timeout";
  return error instanceof SyntaxError ? "not_json" : "network";
}

/** The promise, or a rejection as soon as `signal` aborts, whether or not the HTTP call honours it. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("aborted"));
  return new Promise<T>((resolve, reject) => {
    const stop = (): void => reject(new Error("aborted"));
    signal.addEventListener("abort", stop, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}

export function addlivetagLookup(options: AddlivetagOptions): ThirdPartyLookup {
  const get = options.get ?? fetchGet;
  const key = options.apiKey.trim();
  return {
    async lookup(itemId, signal) {
      const timeout = AbortSignal.timeout(options.timeoutMs ?? ADDLIVETAG_TIMEOUT_MS);
      const both = AbortSignal.any([timeout, signal]);
      const query = new URLSearchParams({ item_id: itemId, key });
      try {
        const answer = await untilAborted(get(`${ADDLIVETAG_API_URL}?${query.toString()}`, { "X-API-Key": key, Accept: "application/json" }, both), both);
        if (answer.status !== 200) return { ok: false, reason: `http_${answer.status}` };
        return readThirdPartyAnswer(await untilAborted(answer.json(), both), itemId);
      } catch (error) {
        return { ok: false, reason: failureOf(error, signal, timeout) };
      }
    },
  };
}
