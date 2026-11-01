/**
 * Resolving the short link the custom-link page returns (Story 5.4, D8, INV-10). The live page
 * shows only the short link (`s.shopee.vn/...`) in its result box, never the long one, so the
 * bridge follows it here, in the real browser, from the service worker: one plain page request
 * to the short-link host that the browser follows to its target, read from the answer's final
 * address only (the body is dropped). It sends no cookies, so the affiliate session is not tied to
 * the visit, and builds no header or signature; it calls no Shopee API. The server never calls
 * Shopee: it reads the sub_ids from the target this answers, on the job's own ticket.
 *
 * Only an https target on a Shopee host is an answer; anything else, a timeout or a network error
 * is null, and the server then treats the link as unresolved (retried uncounted, never attached).
 */
import { hostOnDomain, SHOPEE_LINK_DOMAINS, SHOPEE_SHORT_LINK_DOMAINS } from "@cashback/core";

/** The browser's own request to `url`, followed to its end; its final address. */
export type FollowLink = (url: string, signal: AbortSignal) => Promise<{ readonly finalUrl: string }>;

export type ResolveLink = (url: string) => Promise<string | null>;

/** No resolution: every short link is answered unresolved (the server retries a link job uncounted). */
export const NO_RESOLUTION: ResolveLink = async () => null;

export const RESOLVE_TIMEOUT_MS = 15_000;

const parse = (text: string): URL | null => (URL.canParse(text) ? new URL(text) : null);

/** True for an https Shopee short link that does not show its sub_ids itself. */
export function isShortLink(text: string): boolean {
  const url = parse(text);
  return url !== null && url.protocol === "https:" && hostOnDomain(url.hostname, SHOPEE_SHORT_LINK_DOMAINS) && !url.searchParams.has("utm_content");
}

export function shortLinkResolver(follow: FollowLink, timeoutMs = RESOLVE_TIMEOUT_MS): ResolveLink {
  return async (url) => {
    if (!isShortLink(url)) return null;
    try {
      const { finalUrl } = await follow(url, AbortSignal.timeout(timeoutMs));
      const target = parse(finalUrl);
      if (target === null || target.protocol !== "https:" || target.href === url || !hostOnDomain(target.hostname, SHOPEE_LINK_DOMAINS)) return null;
      return target.href;
    } catch {
      return null;
    }
  };
}
