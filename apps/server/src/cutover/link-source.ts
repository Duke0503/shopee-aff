/**
 * Reading link requests, share codes and products from the live copy (Story 2.5, D56). Request
 * ids, owners and 8-character share codes pass through unchanged, so every link and share page
 * already handed out keeps working. The live states (repository.py:17-19, batch_queue.py:206-210)
 * become the AD-14 states: a request still waiting for its link is QUEUED, one with a link is
 * ISSUED until it was handed over (`notified_at`, repository.py:1305-1310) and DELIVERED after;
 * `converted` is CONVERTED and `failed` FAILED. Live `ready` (the AccessTrade TikTok and Lazada
 * providers, tiktok_provider.py:464, lazada_provider.py:303) and the September `success` rows read
 * like `pending`: a link was made, so it is ISSUED or DELIVERED and its orders stay attributed; one
 * without a link is FAILED and listed. Live `expired` is not a state (D23): it reads
 * like `pending`, except that one that never got its link is FAILED, so no link is made for a
 * request past its window. A request whose customer is gone cannot be imported and is listed.
 */
import type { LinkRequestStatus } from "@cashback/core";
import type BetterSqlite3 from "better-sqlite3";

import type { ImportedLinkRequest, ImportedProductOffer, ImportedShareCode, LinksImport } from "../modules/linking/index";
import { isShareCode } from "../modules/linking/index";
import { networkOfPlatform, ownerOf, type CutoverContext } from "./cutover-context";
import type { ImportReport, LinksSection } from "./import-report";
import { convertLiveTime } from "./live-time";
import { wholeDong } from "./live-values";
import { percentToBps, PRICE, ProductCache, snapshotOf } from "./product-snapshot";

export interface LiveLinkRequest {
  request_id: string;
  customer_id: string;
  created_at: unknown;
  source_url: string;
  affiliate_url: string | null;
  estimated_commission: unknown;
  channel: string | null;
  status: string;
  notified_at: unknown;
  platform: string;
  estimate_detail: string | null;
  attempts: number | null;
  share_code: string | null;
}

const hasLink = (row: LiveLinkRequest): boolean => row.affiliate_url !== null && row.affiliate_url.trim() !== "";
/** The live system handed the link over, or told the customer it failed (repository.py:1305-1310, notifications.py:550). */
export const told = (row: Pick<LiveLinkRequest, "notified_at">): boolean => row.notified_at !== null && row.notified_at !== undefined && row.notified_at !== "";

export function linkStatusOf(row: LiveLinkRequest, report: ImportReport): LinkRequestStatus {
  const issued = (): LinkRequestStatus => (told(row) ? "DELIVERED" : "ISSUED");
  switch (row.status) {
    case "failed":
      return "FAILED";
    case "converted":
      return "CONVERTED";
    case "pending":
      return hasLink(row) ? issued() : "QUEUED";
    case "ready":
    case "success":
      if (hasLink(row)) return issued();
      report.notes.push({ kind: "unknown_link_status", table: "link_requests", key: row.request_id, detail: `${row.status} without link` });
      return "FAILED";
    case "expired":
      if (hasLink(row)) return issued();
      report.notes.push({ kind: "expired_without_link", table: "link_requests", key: row.request_id });
      return "FAILED";
    default:
      report.notes.push({ kind: "unknown_link_status", table: "link_requests", key: row.request_id, detail: row.status });
      return "FAILED";
  }
}

function bps(value: unknown, key: string, column: string, report: ImportReport): number | null {
  const result = percentToBps(value);
  if (result !== "inexact") return result;
  report.notes.push({ kind: "rate_not_whole_bps", table: "products_cache", key, detail: column });
  return null;
}

function productOffersOf(cache: ProductCache, report: ImportReport): ImportedProductOffer[] {
  return cache.rows.map((p) => {
    const time = (column: string, value: unknown) => convertLiveTime(value, { table: "products_cache", column, key: p.item_id }, report).instant;
    return {
      productOfferId: p.item_id,
      shopId: p.shop_id || null,
      name: p.name || null,
      imageUrl: p.image_url || null,
      price: wholeDong(p.price, PRICE),
      shopeeRateBps: bps(p.shopee_rate, p.item_id, "shopee_rate", report),
      sellerRateBps: bps(p.seller_rate, p.item_id, "seller_rate", report),
      canonicalUrl: p.canonical_url || null,
      firstSeenAt: time("first_seen_at", p.first_seen_at),
      updatedAt: time("updated_at", p.updated_at),
    };
  });
}

function requestOf(row: LiveLinkRequest, customerId: string, cache: ProductCache, report: ImportReport, snapshots: LinksSection["snapshots"]): ImportedLinkRequest {
  const time = (column: string, value: unknown) => convertLiveTime(value, { table: "link_requests", column, key: row.request_id }, report).instant;
  const network = networkOfPlatform(row.platform);
  if (network === null) report.notes.push({ kind: "unknown_platform", table: "link_requests", key: row.request_id, detail: row.platform });
  const { source, problems, ...snapshot } = snapshotOf(row, cache);
  snapshots[source]++;
  for (const column of problems) {
    report.notes.push(column === "estimate_detail" ? { kind: "estimate_unreadable", table: "link_requests", key: row.request_id } : { kind: "rate_not_whole_bps", table: "link_requests", key: row.request_id, detail: column });
  }
  return {
    requestId: row.request_id,
    customerId,
    network,
    platform: row.platform,
    channel: row.channel || null,
    status: linkStatusOf(row, report),
    sourceUrl: row.source_url,
    affiliateUrl: hasLink(row) ? row.affiliate_url : null,
    attempts: row.attempts ?? 0,
    estimatedCommission: wholeDong(row.estimated_commission, { allowZero: true }),
    ...snapshot,
    createdAt: time("created_at", row.created_at),
    deliveredAt: time("notified_at", row.notified_at),
  };
}

export function readLiveLinkRows(source: BetterSqlite3.Database): LiveLinkRequest[] {
  return source.prepare("SELECT * FROM link_requests ORDER BY request_id").all() as LiveLinkRequest[];
}

export interface LiveLinks {
  links: LinksImport;
  snapshots: LinksSection["snapshots"];
  /** The live owner each imported request resolved to. */
  owners: ReadonlyMap<string, string>;
}

/** Reads link requests and products; a request whose customer is gone, or a malformed code, is listed. */
export function readLiveLinks(source: BetterSqlite3.Database, rows: readonly LiveLinkRequest[], context: CutoverContext, report: ImportReport): LiveLinks {
  const cache = ProductCache.read(source);
  const snapshots = { estimate: 0, product_cache: 0, none: 0 };
  const linkRequests: ImportedLinkRequest[] = [];
  const shareCodes: ImportedShareCode[] = [];
  const owners = new Map<string, string>();
  for (const row of rows) {
    const owner = ownerOf(context, row.customer_id);
    if (owner === null) {
      report.notes.push({ kind: "link_customer_missing", table: "link_requests", key: row.request_id });
      continue;
    }
    if (owner.via === "alias") report.notes.push({ kind: "link_customer_via_alias", table: "link_requests", key: row.request_id });
    const request = requestOf(row, owner.customerId, cache, report, snapshots);
    linkRequests.push(request);
    owners.set(row.request_id, owner.customerId);
    if (row.share_code === null || row.share_code === "") continue;
    if (!isShareCode(row.share_code)) {
      report.notes.push({ kind: "share_code_invalid", table: "link_requests", key: row.request_id });
      continue;
    }
    shareCodes.push({ code: row.share_code, requestId: row.request_id, createdAt: request.createdAt ?? null });
  }
  return { links: { productOffers: productOffersOf(cache, report), linkRequests, shareCodes }, snapshots, owners };
}
