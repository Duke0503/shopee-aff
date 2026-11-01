/**
 * The checks on a returned link, before it is attached (AD-14, D6, D47, INV-1; Stories 5.1, 5.4).
 *
 * A link from the browser bridge must be on a Shopee host (or, from the fake bridge only, its
 * reserved `.invalid` host) and must carry exactly the job's sub_id1 and sub_id2. Shopee carries
 * the sub_ids in `utm_content`, all five joined by "-" (`C0003-R26091441451---`, as the live
 * `report_reader.py` documents). A short link (`s.shopee.vn/AbC123`) shows them only after its
 * redirect is resolved. The server never calls Shopee (D8): the bridge resolves the short link in
 * the real browser and answers both, on the job's own ticket, and the server checks the resolved
 * link here: it must be on a Shopee host too and carry this job's sub_ids, itself or in a Shopee
 * link nested in one of its parameters; sub_id2 is the request id, so a resolved link that carries
 * it can only belong to this job. A link whose sub_ids cannot be read is never attached; a short
 * link the bridge could not resolve at all is not a check failure but an outage the link job
 * retries (`needsResolution`, Story 5.4 review item 2).
 *
 * A link from the AccessTrade API (Story 5.7) must be on an AccessTrade host. Its sub1 and sub2
 * were sent by the server itself over the authenticated API; when the link or the API's answer
 * carries them back (`sub1`, `sub_1`, `sub2`, `sub_2`), each one given must match the job's, or the
 * link is dropped (review item 4). Its short link is not resolved: that would record a click.
 *
 * Also the back-off of a request whose submission failed, so it never holds up the queue.
 */

import { hostOnDomain, SHOPEE_LINK_DOMAINS, SHOPEE_SHORT_LINK_DOMAINS } from "@cashback/core";

/** The fake bridge's links live on the reserved `.invalid` domain (RFC 2606). */
export const FAKE_BRIDGE_HOST = "fake-bridge.invalid";

/** AccessTrade's link and tracking hosts (the live `tiktok_provider.py`, `fnb_provider.py`). */
const ACCESSTRADE_LINK_DOMAINS = ["shorten.asia", "accesstrade.vn", "isclix.com"] as const;

export type LinkCheckFailure = "not_a_link" | "host_not_allowed" | "sub_ids_unverified" | "sub_ids_mismatch";
export type LinkCheck = { readonly ok: true } | { readonly ok: false; readonly reason: LinkCheckFailure };

/** Who made the link: the affiliate browser through the bridge, or the server over the AccessTrade API. */
export type LinkOrigin = "bridge" | "accesstrade";

export interface LinkCheckInput {
  readonly url: string;
  /** The short link's redirect target, when it was resolved (Story 5.4). */
  readonly resolvedUrl?: string | null;
  readonly subId1: string;
  readonly subId2: string;
  /** Only a link from the fake bridge or the fake AccessTrade creator may be on the fake host. */
  readonly acceptFakeHost: boolean;
  /** `bridge` when omitted. */
  readonly origin?: LinkOrigin;
  /** The sub1 and sub2 the AccessTrade API echoed in its answer, when it did. */
  readonly echoedSubIds?: { readonly sub1: string | null; readonly sub2: string | null };
}

const parse = (text: string): URL | null => (URL.canParse(text) ? new URL(text) : null);
const onShopee = (host: string): boolean => hostOnDomain(host, SHOPEE_LINK_DOMAINS);

function ownSubIds(url: URL): readonly string[] | null {
  const content = url.searchParams.get("utm_content");
  return content === null || content === "" ? null : content.split("-");
}

/** The sub_ids a Shopee link carries itself, or in a Shopee link nested one level in a parameter. */
function shopeeSubIds(url: URL): readonly string[] | null {
  const own = ownSubIds(url);
  if (own !== null) return own;
  for (const value of url.searchParams.values()) {
    const inner = parse(value);
    if (inner !== null && inner.protocol === "https:" && onShopee(inner.hostname.toLowerCase())) {
      const nested = ownSubIds(inner);
      if (nested !== null) return nested;
    }
  }
  return null;
}

/** True for an https Shopee short link that does not show its sub_ids: the link job resolves it first. */
export function needsResolution(text: string): boolean {
  const url = parse(text);
  return url !== null && url.protocol === "https:" && isShopeeShortHost(url.hostname) && ownSubIds(url) === null;
}

export function isShopeeShortHost(host: string): boolean {
  return hostOnDomain(host, SHOPEE_SHORT_LINK_DOMAINS);
}

/** A link as a log line may carry it: scheme, host and path, never the query or the fragment (Story 5.4 AC1). */
export function linkWithoutQuery(text: string): string | null {
  const url = parse(text);
  return url === null ? null : `${url.protocol}//${url.host}${url.pathname}`.slice(0, 200);
}

const param = (url: URL, names: readonly string[]): string | null => names.map((n) => url.searchParams.get(n)).find((v) => v !== null && v !== "") ?? null;

function accessTradeCheck(url: URL, input: LinkCheckInput): LinkCheck {
  const host = url.hostname.toLowerCase();
  if (!(host === FAKE_BRIDGE_HOST ? input.acceptFakeHost : hostOnDomain(host, ACCESSTRADE_LINK_DOMAINS))) return { ok: false, reason: "host_not_allowed" };
  const carried = [
    [param(url, ["sub1", "sub_1"]), input.subId1],
    [param(url, ["sub2", "sub_2"]), input.subId2],
    [input.echoedSubIds?.sub1 ?? null, input.subId1],
    [input.echoedSubIds?.sub2 ?? null, input.subId2],
  ] as const;
  return carried.every(([given, own]) => given === null || given === "" || given === own) ? { ok: true } : { ok: false, reason: "sub_ids_mismatch" };
}

export function checkReturnedLink(input: LinkCheckInput): LinkCheck {
  const url = parse(input.url);
  if (url === null || url.protocol !== "https:" || url.username !== "" || url.password !== "") return { ok: false, reason: "not_a_link" };
  if (input.origin === "accesstrade") return accessTradeCheck(url, input);
  const host = url.hostname.toLowerCase();
  let carried: readonly (string | null)[] | null;
  if (host === FAKE_BRIDGE_HOST) {
    if (!input.acceptFakeHost) return { ok: false, reason: "host_not_allowed" };
    carried = [url.searchParams.get("sub_id1"), url.searchParams.get("sub_id2")];
  } else if (onShopee(host)) {
    const resolved = input.resolvedUrl ? parse(input.resolvedUrl) : null;
    if (input.resolvedUrl && (resolved === null || resolved.protocol !== "https:" || !onShopee(resolved.hostname.toLowerCase()))) return { ok: false, reason: "host_not_allowed" };
    carried = ownSubIds(url) ?? (resolved === null ? null : shopeeSubIds(resolved));
  } else {
    return { ok: false, reason: "host_not_allowed" };
  }
  if (carried === null || carried[0] === null || carried[1] === null) return { ok: false, reason: "sub_ids_unverified" };
  return carried[0] === input.subId1 && carried[1] === input.subId2 ? { ok: true } : { ok: false, reason: "sub_ids_mismatch" };
}

export const RETRY_BASE_MS = 5_000;
export const RETRY_MAX_MS = 15 * 60_000;

/** The wait before a request's next submission after `attempts` failed ones: 5 s, 10 s, 20 s ... up to 15 min. */
export function retryDelayMs(attempts: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));
}
