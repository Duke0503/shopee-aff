/**
 * Which network a pasted product link belongs to (FR-1, AD-22). The Shopee reading (domains,
 * canonical product URL, product key) is `readShopeeProduct` in packages/core, shared with the
 * ledger's backfill function so stored and new requests are keyed by one rule (Story 5.2). TikTok
 * Shop and the polite refusal of other networks come with Story 5.7.
 */
import { readShopeeProduct, shopeeProductKeyOf, type ShopeeProduct } from "@cashback/core";

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
