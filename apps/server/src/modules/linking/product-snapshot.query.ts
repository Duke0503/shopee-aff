/**
 * The product snapshot a link request took when its link was made (D56): name and image, read by
 * the orders module for its lines (payout preview, Story 4.7). An image URL that is not https is
 * left out, so the desk never loads an image over plain http.
 */
import { inArray } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { linkRequests } from "./schema";

export interface ProductSnapshot {
  readonly productName: string | null;
  readonly productImageUrl: string | null;
}

const httpsOnly = (url: string | null): string | null => (url !== null && url.startsWith("https://") ? url : null);

/** The snapshot of each request named, by request id; an unknown request is absent. */
export function productSnapshotsOf(db: LedgerDb, requestIds: readonly string[]): Map<string, ProductSnapshot> {
  const ids = [...new Set(requestIds)];
  if (ids.length === 0) return new Map();
  const rows = db.select({ requestId: linkRequests.requestId, productName: linkRequests.productName, productImageUrl: linkRequests.productImageUrl }).from(linkRequests).where(inArray(linkRequests.requestId, ids)).all();
  return new Map(rows.map((r) => [r.requestId, { productName: r.productName, productImageUrl: httpsOnly(r.productImageUrl) }]));
}
