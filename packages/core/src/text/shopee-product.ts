/**
 * The one reading of a pasted Shopee link (FR-1, FR-5, D5, D6; Stories 5.1, 5.2). It lives here,
 * not in the linking module, because the ledger registers it as the SQL function
 * `shopee_product_key` (platform/db/ledger.ts), so a migration backfills stored requests with
 * exactly the rule new requests use, and platform code never imports a module.
 *
 * Shopee hands out links on shopee.vn, shope.ee and shp.ee and any subdomain of them; ShopeeFood
 * is a different programme. Only http and https links without credentials count.
 *
 * A product is named by its shop id and item id, in either live form (`Name-i.<shop>.<item>` or
 * `/<anything>/<shop>/<item>`, as the live `third_party_lookup.py` reads them). Such a link is kept
 * as the short canonical product URL `https://shopee.vn/product/<shop>/<item>`, so a long
 * percent-encoded product name or a tracking query never reaches the bridge, and it gets the
 * product key `shopee:<shop>.<item>` that link reuse looks up. Any other Shopee link (a short link,
 * a search, a shop, a flash sale, the home page) is kept as it is and gets no product key: it never
 * names one product, so it is never reused.
 */

/** The parts of a WHATWG URL read here. */
interface ParsedUrl {
  readonly protocol: string;
  readonly username: string;
  readonly password: string;
  readonly hostname: string;
  readonly pathname: string;
  readonly href: string;
}

/**
 * The WHATWG `URL` every runtime of this package has (Node 24, Chrome). The ES2022 library this
 * package compiles against does not declare it, and core takes no DOM or Node typings.
 */
const WhatwgUrl = (globalThis as unknown as { URL: { new (text: string): ParsedUrl; canParse(text: string): boolean } }).URL;

/** The longest source link a bridge job may carry (packages/contracts bridge.schema.ts). */
export const SHOPEE_SOURCE_MAX_LENGTH = 2048;

/** The longest paste a link request accepts; a product link is cut down to its ids. */
export const SHOPEE_PASTE_MAX_LENGTH = 8 * SHOPEE_SOURCE_MAX_LENGTH;
const SHOPEE_DOMAINS = ["shopee.vn", "shope.ee", "shp.ee"] as const;
const NOT_SHOPEE_PRODUCTS = ["food.shopee.vn", "shopeefood.vn"] as const;
const ITEM_IN_NAME = /-i\.(\d+)\.(\d+)(?:[/?#]|$)/;
const ITEM_IN_PATH = /\/(\d{5,})\/(\d{5,})(?:[/?#]|$)/;
const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/i;

export type ShopeeProduct = { readonly ok: true; readonly sourceUrl: string; readonly productKey: string | null } | { readonly ok: false; readonly reason: "not_shopee" | "too_long" };

const onDomain = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`);

/** The link as a request keeps it and its product key, or why it cannot be a link request. */
export function readShopeeProduct(text: string): ShopeeProduct {
  const trimmed = text.trim();
  if (trimmed.length === 0 || !WhatwgUrl.canParse(trimmed)) return { ok: false, reason: "not_shopee" };
  // A pasted product link may be long (an encoded product name); only its ids are kept, so the paste is bounded loosely.
  if (trimmed.length > SHOPEE_PASTE_MAX_LENGTH) return { ok: false, reason: "too_long" };
  const url = new WhatwgUrl(trimmed);
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: "not_shopee" };
  if (url.username !== "" || url.password !== "") return { ok: false, reason: "not_shopee" };
  const host = url.hostname.toLowerCase();
  if (NOT_SHOPEE_PRODUCTS.some((d) => onDomain(host, d)) || url.pathname.startsWith("/now-food")) return { ok: false, reason: "not_shopee" };
  if (!SHOPEE_DOMAINS.some((d) => onDomain(host, d))) return { ok: false, reason: "not_shopee" };
  const ids = ITEM_IN_NAME.exec(url.pathname) ?? ITEM_IN_PATH.exec(url.pathname);
  if (ids) return { ok: true, sourceUrl: `https://shopee.vn/product/${ids[1]}/${ids[2]}`, productKey: `shopee:${ids[1]}.${ids[2]}` };
  if (url.href.length > SHOPEE_SOURCE_MAX_LENGTH) return { ok: false, reason: "too_long" };
  return { ok: true, sourceUrl: url.href, productKey: null };
}

/**
 * The product key of stored text, for the cutover import and the backfill: the live system kept
 * some requests as the whole pasted message, so the first link inside the text is read when the
 * text itself is not a link.
 */
export function shopeeProductKeyOf(text: string | null): string | null {
  if (text === null) return null;
  const direct = readShopeeProduct(text);
  if (direct.ok) return direct.productKey;
  const found = URL_IN_TEXT.exec(text)?.[0];
  if (found === undefined || found === text.trim()) return null;
  const inner = readShopeeProduct(found);
  return inner.ok ? inner.productKey : null;
}
