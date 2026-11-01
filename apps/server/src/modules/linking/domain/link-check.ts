/**
 * The checks on a link the bridge returns, before it is attached (AD-14, D6, D47, INV-1). The
 * link must be on a Shopee host (or, from the fake bridge only, its reserved `.invalid` host) and
 * must carry exactly the job's sub_id1 and sub_id2. Shopee carries the sub_ids in `utm_content`,
 * all five joined by "-" (`C0003-R26091441451---`, as the live `report_reader.py` documents);
 * a short link (`s.shopee.vn/AbC123`) shows them only after its redirect is resolved, which
 * Story 5.4 does outside any transaction and hands in as `resolvedUrl`. A link whose sub_ids
 * cannot be read is never attached.
 *
 * Also the back-off of a request whose submission failed, so it never holds up the queue.
 */

/** The fake bridge's links live on the reserved `.invalid` domain (RFC 2606). */
export const FAKE_BRIDGE_HOST = "fake-bridge.invalid";

const SHOPEE_LINK_DOMAINS = ["shopee.vn", "shope.ee", "shp.ee"] as const;

export type LinkCheckFailure = "not_a_link" | "host_not_allowed" | "sub_ids_unverified" | "sub_ids_mismatch";
export type LinkCheck = { readonly ok: true } | { readonly ok: false; readonly reason: LinkCheckFailure };

export interface LinkCheckInput {
  readonly url: string;
  /** The short link's redirect target, when it was resolved (Story 5.4). */
  readonly resolvedUrl?: string | null;
  readonly subId1: string;
  readonly subId2: string;
  /** Only a link from the fake bridge may be on the fake host. */
  readonly acceptFakeHost: boolean;
}

const parse = (text: string): URL | null => (URL.canParse(text) ? new URL(text) : null);
const onShopee = (host: string): boolean => SHOPEE_LINK_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));

function shopeeSubIds(url: URL): readonly string[] | null {
  const content = url.searchParams.get("utm_content");
  return content === null || content === "" ? null : content.split("-");
}

export function checkReturnedLink(input: LinkCheckInput): LinkCheck {
  const url = parse(input.url);
  if (url === null || url.protocol !== "https:") return { ok: false, reason: "not_a_link" };
  const host = url.hostname.toLowerCase();
  let carried: readonly (string | null)[] | null;
  if (host === FAKE_BRIDGE_HOST) {
    if (!input.acceptFakeHost) return { ok: false, reason: "host_not_allowed" };
    carried = [url.searchParams.get("sub_id1"), url.searchParams.get("sub_id2")];
  } else if (onShopee(host)) {
    const resolved = input.resolvedUrl ? parse(input.resolvedUrl) : null;
    if (input.resolvedUrl && (resolved === null || !onShopee(resolved.hostname.toLowerCase()))) return { ok: false, reason: "host_not_allowed" };
    carried = shopeeSubIds(url) ?? (resolved === null ? null : shopeeSubIds(resolved));
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
