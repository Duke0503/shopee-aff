import type { Db } from "../../../shared/database/connection";
import {
  countCached,
  countWithAffiliateUrl,
  listHotProducts,
} from "../infrastructure/products-cache.repository";

/**
 * Cached product rows as the assistant reads them. The keys stay snake_case
 * on purpose: this is the shape the bot already parses, and renaming a field
 * here would silently empty a group message.
 */
export interface CachedProductView {
  item_id: string;
  shop_id: string | null;
  name: string | null;
  price: number | null;
  price_formatted: string | null;
  shopee_rate: number | null;
  seller_rate: number | null;
  shopee_part: number | null;
  shopee_part_formatted: string | null;
  seller_part: number | null;
  seller_part_formatted: string | null;
  total_commission: number | null;
  commission_formatted: string | null;
  is_capped: number | null;
  cashback: number | null;
  cashback_formatted: string | null;
  rate_percent: string | null;
  affiliate_url: string | null;
  canonical_url: string | null;
  request_count: number | null;
  first_seen_at: string;
  updated_at: string;
  image_url: string | null;
}

export interface CacheStatsView {
  ok: true;
  total_cached: number;
  with_affiliate_url: number;
  top_products: CachedProductView[];
}

export function cacheStats(db: Db, limit = 10): CacheStatsView {
  return {
    ok: true,
    total_cached: countCached(db),
    with_affiliate_url: countWithAffiliateUrl(db),
    top_products: listHotProducts(db, limit).map((row) => ({
      item_id: row.itemId,
      shop_id: row.shopId,
      name: row.name,
      price: row.price,
      price_formatted: row.priceFormatted,
      shopee_rate: row.shopeeRate,
      seller_rate: row.sellerRate,
      shopee_part: row.shopeePart,
      shopee_part_formatted: row.shopeePartFormatted,
      seller_part: row.sellerPart,
      seller_part_formatted: row.sellerPartFormatted,
      total_commission: row.totalCommission,
      commission_formatted: row.commissionFormatted,
      is_capped: row.isCapped,
      cashback: row.cashback,
      cashback_formatted: row.cashbackFormatted,
      rate_percent: row.ratePercent,
      affiliate_url: row.affiliateUrl,
      canonical_url: row.canonicalUrl,
      request_count: row.requestCount,
      first_seen_at: row.firstSeenAt,
      updated_at: row.updatedAt,
      image_url: row.imageUrl,
    })),
  };
}
