import { desc } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { campaigns } from "../../../shared/database/schema";

/** Campaigns are rows of data, not code. Newest event first. */
export function listCampaigns(db: Db) {
  return db.select().from(campaigns).orderBy(desc(campaigns.startsAt)).all();
}
