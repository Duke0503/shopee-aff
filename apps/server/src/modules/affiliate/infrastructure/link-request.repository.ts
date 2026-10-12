import { and, desc, eq, inArray, ne } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { linkRequests } from "../../../shared/database/schema";
import { isWithinResendWindow, resendCutoffLocal } from "../domain/reuse-policy";
import { isValidShareCode } from "../domain/share-code";

/**
 * `link_requests` persistence. The one rule that matters here: a link is
 * reused ONLY for the SAME customer (`findOwnRequest`), never by product.
 */
export interface NewLinkRequest {
  requestId: string;
  customerId: string;
  sourceUrl: string;
  platform: string;
  createdAt: string;
  estimatedCommission?: number | null;
}

export function recordLinkRequest(db: Db, input: NewLinkRequest): void {
  db.insert(linkRequests)
    .values({
      requestId: input.requestId,
      customerId: input.customerId,
      sourceUrl: input.sourceUrl,
      platform: input.platform,
      status: "pending",
      createdAt: input.createdAt,
      estimatedCommission: input.estimatedCommission ?? null,
    })
    .run();
}

export function attachAffiliateUrl(db: Db, requestId: string, affiliateUrl: string): void {
  db.update(linkRequests)
    .set({ affiliateUrl })
    .where(eq(linkRequests.requestId, requestId))
    .run();
}

/** The customer a link request was made for, or null. Evidence for attribution. */
export function findLinkRequestOwner(db: Db, requestId: string): string | null {
  const row = db
    .select({ customerId: linkRequests.customerId })
    .from(linkRequests)
    .where(eq(linkRequests.requestId, requestId))
    .get();
  return row?.customerId ?? null;
}

/** This customer's own request for one of these spellings, within the window. */
export function findOwnRequest(
  db: Db,
  input: { customerId: string; sourceUrls: string[]; attributionDays: number; nowIso: string },
) {
  const urls = [...new Set(input.sourceUrls.filter((url) => url !== ""))];
  if (urls.length === 0) return null;

  const cutoff = resendCutoffLocal(Date.parse(input.nowIso), input.attributionDays);
  const rows = db
    .select()
    .from(linkRequests)
    .where(
      and(
        eq(linkRequests.customerId, input.customerId),
        inArray(linkRequests.sourceUrl, urls),
        ne(linkRequests.status, "failed"),
      ),
    )
    .orderBy(desc(linkRequests.createdAt))
    .all();
  return rows.find((row) => isWithinResendWindow(row.createdAt, cutoff)) ?? null;
}

export function markLinkDelivered(db: Db, requestId: string, nowIso: string): void {
  db.update(linkRequests)
    .set({ notifiedAt: nowIso })
    .where(eq(linkRequests.requestId, requestId))
    .run();
}

export function setShareCode(db: Db, requestId: string, code: string): void {
  if (!isValidShareCode(code)) throw new Error(`invalid share code: ${code}`);
  db.update(linkRequests).set({ shareCode: code }).where(eq(linkRequests.requestId, requestId)).run();
}

/** The request behind a share code, if it has a link to go to. */
export function findByShareCode(db: Db, code: string) {
  if (!isValidShareCode(code)) return null;
  const row = db.select().from(linkRequests).where(eq(linkRequests.shareCode, code)).get();
  return row && row.affiliateUrl ? row : null;
}
