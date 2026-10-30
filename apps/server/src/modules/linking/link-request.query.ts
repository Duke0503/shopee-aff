/**
 * The owner of a link request (AD-8, D47): sub_id2 of a report row is the request id, and
 * attribution falls back to the customer stored on that request when sub_id1 is empty. The
 * request's platform is the shop the order came from.
 */
import { eq } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { linkRequests } from "./schema";

export interface LinkRequestOwner {
  readonly requestId: string;
  /** The customer id stored on the request; it may no longer resolve to anyone. */
  readonly customerId: string;
  readonly platform: string;
}

export function findLinkRequestOwner(db: LedgerDb, requestId: string): LinkRequestOwner | null {
  if (requestId.trim() === "") return null;
  const row = db
    .select({ requestId: linkRequests.requestId, customerId: linkRequests.customerId, platform: linkRequests.platform })
    .from(linkRequests)
    .where(eq(linkRequests.requestId, requestId))
    .get();
  return row ?? null;
}
