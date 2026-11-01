/**
 * What the share page `/s/<code>` needs (FR-6, AD-14, D5, D56; Story 5.8): the stored affiliate
 * link of the code's request, its product snapshot, its network, and whether it is a guest link.
 * Only a code of 8 or 10 base62 characters is looked up (imported live codes are 8), and only a
 * request with a stored link the share page may open (`isShareTarget`) is returned; anything else
 * is "not found", so the page can never be an open redirect.
 */
import { eq } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { isGuestCustomer } from "../identity/index";
import { isShareTarget } from "./domain/link-check";
import type { ProductSnapshotFacts } from "./domain/link-reply";
import { isShareCode } from "./link-import.command";
import { httpsImageUrl } from "./product-snapshot.query";
import { linkRequests, shareCodes } from "./schema";

export interface SharePageLink extends ProductSnapshotFacts {
  readonly code: string;
  readonly requestId: string;
  /** The stored, checked link the page redirects to. */
  readonly target: string;
  readonly guest: boolean;
}

export function sharePageLink(db: LedgerDb, code: string, acceptFakeHost = false): SharePageLink | null {
  if (!isShareCode(code)) return null;
  const row = db
    .select({
      code: shareCodes.code,
      requestId: shareCodes.requestId,
      customerId: linkRequests.customerId,
      network: linkRequests.network,
      platform: linkRequests.platform,
      target: linkRequests.affiliateUrl,
      productName: linkRequests.productName,
      productImageUrl: linkRequests.productImageUrl,
      productPrice: linkRequests.productPrice,
      shopeeRateBps: linkRequests.shopeeRateBps,
      sellerRateBps: linkRequests.sellerRateBps,
    })
    .from(shareCodes)
    .innerJoin(linkRequests, eq(linkRequests.requestId, shareCodes.requestId))
    .where(eq(shareCodes.code, code))
    .get();
  if (row === undefined || row.target === null || !isShareTarget(row.target, acceptFakeHost)) return null;
  const network = row.network ?? (row.platform === "tiktok" ? "accesstrade" : "shopee");
  return {
    code: row.code,
    requestId: row.requestId,
    target: row.target,
    guest: isGuestCustomer(db, row.customerId),
    network,
    platform: row.platform,
    productName: row.productName,
    productImageUrl: httpsImageUrl(row.productImageUrl),
    productPrice: row.productPrice,
    shopeeRateBps: row.shopeeRateBps,
    sellerRateBps: row.sellerRateBps,
  };
}
