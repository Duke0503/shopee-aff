/**
 * The one reading of a pasted ShopeeFood link (FR-1, D6, D8, D60; Story 5.11), shared by the
 * server's link request and the bridge extension. ShopeeFood is a link source on the Shopee
 * network: its links are on `shopeefood.vn`, `food.shopee.vn` or under `shopee.vn/now-food`, as the
 * live `shopeefood_provider.py` accepts them.
 *
 * A shop is named by its shop id: `/now-food/shop/<id>` on any of those hosts, or the `shopId` in
 * the base64 JSON token of a group-order invite (`/group-order/invite?token=...`), decoded here
 * without any network call. Such a link is kept as the canonical shop URL
 * `https://shopeefood.vn/now-food/shop/<id>` with the reuse key `shopeefood:<id>`. A short link
 * (`shopeefood.vn/u/...`, `/share/...`) names no shop until it is resolved, which only the real
 * browser does (D8): it is kept as pasted and marked `resolve`. Any other ShopeeFood page (a dish or
 * a shop by its name) is kept without its query and has no key, so it is never reused.
 */

import { hostOnDomain } from "./host-domain";

interface ParsedUrl {
  readonly protocol: string;
  readonly username: string;
  readonly password: string;
  readonly hostname: string;
  readonly pathname: string;
  readonly origin: string;
  readonly href: string;
  readonly searchParams: { get(name: string): string | null };
}

/** The WHATWG `URL` and `atob` every runtime of this package has (Node 24, Chrome); see shopee-product.ts. */
const runtime = globalThis as unknown as { URL: { new (text: string): ParsedUrl; canParse(text: string): boolean }; atob(text: string): string };

/** ShopeeFood's own hosts; `shopee.vn/now-food` is ShopeeFood too. */
export const SHOPEEFOOD_DOMAINS = ["shopeefood.vn", "food.shopee.vn"] as const;
const SHOP_IN_PATH = /\/now-food\/shop\/(\d{1,20})(?:[/?#]|$)/;
const SHORT_PATHS = ["/u/", "/share/"] as const;
const MAX_LINK_LENGTH = 2048;

export type ShopeeFoodLink = { readonly ok: true; readonly sourceUrl: string; readonly shopId: string | null; readonly resolve: boolean } | { readonly ok: false; readonly reason: "not_shopeefood" | "too_long" };

export const shopeeFoodShopUrl = (shopId: string): string => `https://shopeefood.vn/now-food/shop/${shopId}`;
export const shopeeFoodKey = (shopId: string): string => `shopeefood:${shopId}`;

function parse(text: string): ParsedUrl | null {
  const trimmed = text.trim();
  if (trimmed.length === 0 || !runtime.URL.canParse(trimmed)) return null;
  const url = new runtime.URL(trimmed);
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return url.username === "" && url.password === "" ? url : null;
}

const onShopeeFood = (url: ParsedUrl): boolean => hostOnDomain(url.hostname, SHOPEEFOOD_DOMAINS) || (hostOnDomain(url.hostname, ["shopee.vn"]) && url.pathname.startsWith("/now-food"));

/** The shop id in a group-order invite's token (base64 or base64url JSON), or null. */
function inviteShopId(url: ParsedUrl): string | null {
  if (!url.pathname.includes("/group-order/invite")) return null;
  const token = url.searchParams.get("token");
  if (token === null || token.length === 0 || token.length > MAX_LINK_LENGTH) return null;
  try {
    const base64 = token.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(runtime.atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "="))) as unknown;
    const shopId = payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>)["shopId"] : null;
    const text = typeof shopId === "number" && Number.isSafeInteger(shopId) ? String(shopId) : shopId;
    return typeof text === "string" && /^\d{1,20}$/.test(text) ? text : null;
  } catch {
    return null;
  }
}

/** True for an http(s) link on ShopeeFood. */
export function isShopeeFoodLink(text: string): boolean {
  const url = parse(text);
  return url !== null && onShopeeFood(url);
}

/** The ShopeeFood link as a request keeps it, its shop id when the link names one, and whether only the browser can tell the shop. */
export function readShopeeFoodLink(text: string): ShopeeFoodLink {
  const url = parse(text);
  if (url === null || !onShopeeFood(url)) return { ok: false, reason: "not_shopeefood" };
  const shopId = SHOP_IN_PATH.exec(url.pathname)?.[1] ?? inviteShopId(url);
  if (shopId !== null) return { ok: true, sourceUrl: shopeeFoodShopUrl(shopId), shopId, resolve: false };
  if (url.href.length > MAX_LINK_LENGTH) return { ok: false, reason: "too_long" };
  if (SHORT_PATHS.some((p) => url.pathname.startsWith(p)) || url.pathname.includes("/group-order/invite")) return { ok: true, sourceUrl: url.href, shopId: null, resolve: true };
  return { ok: true, sourceUrl: `${url.origin}${url.pathname}`, shopId: null, resolve: false };
}
