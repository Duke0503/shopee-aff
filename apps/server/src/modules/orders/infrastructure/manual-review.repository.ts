import { and, eq, isNull } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { manualReview } from "../../../shared/database/schema";

/**
 * A report row we could not match or understand. We NEVER guess, so it waits
 * for a person. A row already filed with the same reason is not filed again
 * (otherwise the same unknown row would pile up every hour).
 */
export interface ReviewItem {
  orderId: string | null;
  rawData: string;
  reason: string;
  createdAt: string;
}

export function flagForReview(db: Db, item: ReviewItem): boolean {
  const orderMatch =
    item.orderId === null ? isNull(manualReview.orderId) : eq(manualReview.orderId, item.orderId);
  const existing = db
    .select({ id: manualReview.id })
    .from(manualReview)
    .where(and(orderMatch, eq(manualReview.reason, item.reason), eq(manualReview.resolved, 0)))
    .get();
  if (existing) return false;

  db.insert(manualReview)
    .values({
      orderId: item.orderId,
      rawData: item.rawData,
      reason: item.reason,
      createdAt: item.createdAt,
      resolved: 0,
    })
    .run();
  return true;
}

export function listOpenReviews(db: Db) {
  return db.select().from(manualReview).where(eq(manualReview.resolved, 0)).all();
}
