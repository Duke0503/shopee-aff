import { eq } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { linkClicks } from "../../../shared/database/schema";

/** Visits to our `/s/<code>` share link. Link-preview bots are not clicks. */
export function recordClick(db: Db, requestId: string, agent: string, clickedAt: string): void {
  db.insert(linkClicks).values({ requestId, agent, clickedAt }).run();
}

export function countClicks(db: Db, requestId: string): number {
  return db.select().from(linkClicks).where(eq(linkClicks.requestId, requestId)).all().length;
}
