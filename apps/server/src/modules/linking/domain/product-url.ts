/**
 * Which network a pasted product link belongs to (FR-1, AD-22). Shopee hands out links on
 * shopee.vn, shope.ee and shp.ee and any subdomain of them (s.shopee.vn, vn.shp.ee), as the live
 * `dashboard_lookup.py` lists them in one place; ShopeeFood is a different programme and is not a
 * Shopee product. Only http and https links count. TikTok Shop and the polite refusal of other
 * networks come with Story 5.7.
 */

const SHOPEE_DOMAINS = ["shopee.vn", "shope.ee", "shp.ee"] as const;
const NOT_SHOPEE_PRODUCTS = ["food.shopee.vn", "shopeefood.vn"] as const;
const MAX_URL_LENGTH = 2048;

const onDomain = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`);

/** The product link as the request keeps it, or null when it is not a Shopee product link. */
export function shopeeProductUrl(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH || !URL.canParse(trimmed)) return null;
  const url = new URL(trimmed);
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username !== "" || url.password !== "") return null;
  const host = url.hostname.toLowerCase();
  if (NOT_SHOPEE_PRODUCTS.some((d) => onDomain(host, d)) || url.pathname.startsWith("/now-food")) return null;
  return SHOPEE_DOMAINS.some((d) => onDomain(host, d)) ? url.href : null;
}

/** Letters and digits only, never empty (D7). */
export const SUB_ID_PATTERN = /^[A-Za-z0-9]+$/;
