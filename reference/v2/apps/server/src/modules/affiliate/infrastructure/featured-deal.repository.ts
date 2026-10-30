import { asc, eq } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { featuredDeals } from "../../../shared/database/schema";

/** Hand-picked deals shown on the website, in their chosen order. */
export function listActiveDeals(db: Db) {
  return db
    .select()
    .from(featuredDeals)
    .where(eq(featuredDeals.isActive, 1))
    .orderBy(asc(featuredDeals.sortOrder))
    .all();
}
