/**
 * What the assistant's reply to one link request rests on (FR-1, D56, D60; Story 6.3): the
 * request's status, its share code once the link is made, its product snapshot and whether the
 * product lookup has had its say. The reply waits for the facts only while a lookup may still add
 * them: a request with an estimate, a link that is not a Shopee product (TikTok Shop, ShopeeFood,
 * a search or shop link), or a request whose lookup job has ended needs no more waiting.
 */
import type { Instant } from "@cashback/core";
import { and, eq, ne } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import type { ProductSnapshotFacts } from "./domain/link-reply";
import { shopeeQueueStopReason } from "./link-queue.command";
import { httpsImageUrl } from "./product-snapshot.query";
import { bridgeJobs, linkRequests, shareCodes, type LINK_REQUEST_STATUSES } from "./schema";

export interface LinkReplyFacts extends ProductSnapshotFacts {
  readonly requestId: string;
  readonly customerId: string;
  readonly status: (typeof LINK_REQUEST_STATUSES)[number];
  readonly shareCode: string | null;
  readonly factsSettled: boolean;
}

/** True while this request waits behind a stopped Shopee queue (D65): a TikTok Shop request is served all the same. */
export function waitsBehindStoppedQueue(db: LedgerDb, facts: Pick<LinkReplyFacts, "status" | "network">, now: Instant): boolean {
  return facts.status === "QUEUED" && facts.network === "shopee" && shopeeQueueStopReason(db, now) !== null;
}

export function linkReplyFactsOf(db: LedgerDb, requestId: string): LinkReplyFacts | null {
  const row = db
    .select({
      requestId: linkRequests.requestId,
      customerId: linkRequests.customerId,
      status: linkRequests.status,
      network: linkRequests.network,
      platform: linkRequests.platform,
      productKey: linkRequests.productKey,
      productName: linkRequests.productName,
      productImageUrl: linkRequests.productImageUrl,
      productPrice: linkRequests.productPrice,
      shopeeRateBps: linkRequests.shopeeRateBps,
      sellerRateBps: linkRequests.sellerRateBps,
      code: shareCodes.code,
    })
    .from(linkRequests)
    .leftJoin(shareCodes, eq(shareCodes.requestId, linkRequests.requestId))
    .where(eq(linkRequests.requestId, requestId))
    .get();
  if (row === undefined) return null;
  const network = row.network ?? (row.platform === "tiktok" ? "accesstrade" : "shopee");
  const lookedUp = (): boolean => db.select({ id: bridgeJobs.jobId }).from(bridgeJobs).where(and(eq(bridgeJobs.requestId, requestId), eq(bridgeJobs.kind, "LOOKUP"), ne(bridgeJobs.status, "PENDING"))).get() !== undefined;
  const noLookup = network !== "shopee" || row.platform === "shopeefood" || row.productKey === null || !row.productKey.startsWith("shopee:");
  return {
    requestId: row.requestId,
    customerId: row.customerId,
    status: row.status,
    shareCode: row.code,
    network,
    platform: row.platform,
    productName: row.productName,
    productImageUrl: httpsImageUrl(row.productImageUrl),
    productPrice: row.productPrice,
    shopeeRateBps: row.shopeeRateBps,
    sellerRateBps: row.sellerRateBps,
    factsSettled: row.shopeeRateBps !== null || noLookup || lookedUp(),
  };
}
