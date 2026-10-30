import { desc, isNotNull, sql } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { productsCache } from "../../../shared/database/schema";

/**
 * What the Shopee commission lookups have learned so far. The bot reports
 * these to the group as "hot products", and the refresh job re-price the ones
 * that have gone stale.
 */

export function countCached(db: Db): number {
  return db.select({ total: sql<number>`count(*)` }).from(productsCache).get()?.total ?? 0;
}

/** Cached rows that already carry a link the customers can be sent to. */
export function countWithAffiliateUrl(db: Db): number {
  return (
    db
      .select({ total: sql<number>`count(*)` })
      .from(productsCache)
      .where(isNotNull(productsCache.affiliateUrl))
      .get()?.total ?? 0
  );
}

/** Most asked-for first, newest first on a tie — the list the bot shows. */
export function listHotProducts(db: Db, limit = 10) {
  return db
    .select()
    .from(productsCache)
    .orderBy(desc(productsCache.requestCount), desc(productsCache.updatedAt))
    .limit(limit)
    .all();
}
