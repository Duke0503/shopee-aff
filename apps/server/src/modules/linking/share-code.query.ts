/**
 * Looking up a share code (AD-14, FR-6): `/s/<code>` opens the link request the code was made
 * for, and so its one customer's affiliate link. A code that is not 8 or 10 base62 characters
 * is never looked up, so the share page can never be used as an open redirect.
 */
import { eq } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { isShareCode } from "./link-import.command";
import { linkRequests, shareCodes } from "./schema";

export interface SharedLink {
  readonly code: string;
  readonly requestId: string;
  readonly customerId: string;
  readonly affiliateUrl: string | null;
}

export function findShareCode(db: LedgerDb, code: string): SharedLink | null {
  if (!isShareCode(code)) return null;
  const row = db
    .select({ code: shareCodes.code, requestId: shareCodes.requestId, customerId: linkRequests.customerId, affiliateUrl: linkRequests.affiliateUrl })
    .from(shareCodes)
    .innerJoin(linkRequests, eq(linkRequests.requestId, shareCodes.requestId))
    .where(eq(shareCodes.code, code))
    .get();
  return row ?? null;
}
