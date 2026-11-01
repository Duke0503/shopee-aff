/**
 * Which network a pasted product link belongs to (FR-1, AD-22, D17). The Shopee reading (domains,
 * canonical product URL, product key) is `readShopeeProduct` in packages/core, shared with the
 * ledger's backfill function so stored and new requests are keyed by one rule (Story 5.2).
 *
 * A TikTok Shop link (Story 5.7) is served through AccessTrade: any http(s) link on tiktok.com or
 * tiktok.shop and their subdomains, as the live `tiktok_provider.py` accepts them (app short links
 * `vt.tiktok.com`, `vm.tiktok.com`, web product pages, videos with a basket). It is kept as pasted
 * (AccessTrade reads the short link itself); a link that names a product (`/product/<id>`,
 * `/pdp/<id>`) gets the product key `tiktok:<id>` that link reuse looks up. Every other link,
 * Lazada included, is refused as `network_unsupported`, so the customer hears which networks earn
 * cashback. The host decides first, so a long Lazada link is refused as unsupported, never as too
 * long (review item 6).
 *
 * A ShopeeFood link (Story 5.11, D60) is a Shopee-network link on the platform `shopeefood`: read by
 * `readShopeeFoodLink` in packages/core, keyed by its shop (`shopeefood:<shopId>`) when the link
 * names one; a short link gets its key from the browser that resolves it (link-result.command.ts).
 */
import { hostOnDomain, readShopeeFoodLink, readShopeeProduct, SHOPEE_LINK_DOMAINS, SHOPEE_SOURCE_MAX_LENGTH, shopeeFoodKey, shopeeProductKeyOf, type ShopeeProduct } from "@cashback/core";

export { readShopeeProduct, shopeeProductKeyOf, type ShopeeProduct };

/** The link as a request keeps it, or null when it is not a usable Shopee link. */
export function shopeeProductUrl(text: string): string | null {
  const product = readShopeeProduct(text);
  return product.ok ? product.sourceUrl : null;
}

/** `shopee:<shop>.<item>` for a link that names one product; null for anything else. */
export function shopeeProductKey(text: string): string | null {
  const product = readShopeeProduct(text);
  return product.ok ? product.productKey : null;
}

/** Letters and digits only, never empty (D7). */
export const SUB_ID_PATTERN = /^[A-Za-z0-9]+$/;

const TIKTOK_DOMAINS = ["tiktok.com", "tiktok.shop"] as const;
const TIKTOK_PRODUCT_ID = /\/(?:product|pdp)\/(\d{5,})(?:[/?#]|$)/;

export type ProductLink =
  | { readonly ok: true; readonly network: "shopee"; readonly platform: "shopee" | "shopeefood"; readonly sourceUrl: string; readonly productKey: string | null }
  | { readonly ok: true; readonly network: "accesstrade"; readonly platform: "tiktok"; readonly sourceUrl: string; readonly productKey: string | null }
  | { readonly ok: false; readonly reason: "network_unsupported" | "too_long" };

function linkHost(text: string): string | null {
  const trimmed = text.trim();
  if (!URL.canParse(trimmed)) return null;
  const url = new URL(trimmed);
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username !== "" || url.password !== "") return null;
  return url.hostname.toLowerCase();
}

function readTikTokLink(text: string): ProductLink {
  const url = new URL(text.trim());
  if (url.href.length > SHOPEE_SOURCE_MAX_LENGTH) return { ok: false, reason: "too_long" };
  const id = TIKTOK_PRODUCT_ID.exec(url.pathname)?.[1];
  return { ok: true, network: "accesstrade", platform: "tiktok", sourceUrl: url.href, productKey: id === undefined ? null : `tiktok:${id}` };
}

/** The network, the link as a request keeps it and its product key, or why it is refused. */
export function readProductLink(text: string): ProductLink {
  const host = linkHost(text);
  if (host === null) return { ok: false, reason: "network_unsupported" };
  if (hostOnDomain(host, TIKTOK_DOMAINS)) return readTikTokLink(text);
  const food = readShopeeFoodLink(text);
  if (food.ok) return { ok: true, network: "shopee", platform: "shopeefood", sourceUrl: food.sourceUrl, productKey: food.shopId === null ? null : shopeeFoodKey(food.shopId) };
  if (food.reason === "too_long") return { ok: false, reason: "too_long" };
  if (!hostOnDomain(host, SHOPEE_LINK_DOMAINS)) return { ok: false, reason: "network_unsupported" };
  const shopee = readShopeeProduct(text);
  if (shopee.ok) return { ok: true, network: "shopee", platform: "shopee", sourceUrl: shopee.sourceUrl, productKey: shopee.productKey };
  return { ok: false, reason: shopee.reason === "too_long" ? "too_long" : "network_unsupported" };
}
