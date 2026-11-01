/**
 * The cutover import of links (AD-24, AD-14, Story 2.5): product offers, link requests with
 * their product snapshot (D56), and share codes, written exactly as given into empty tables
 * inside the caller's `tx`. Request ids and share codes pass through unchanged, so every old
 * `/s/<code>` link still opens its own customer's affiliate link. Rows are written in key order
 * so two imports of one source give identical ledgers. The import writes one audit entry with its
 * counts in the same transaction (AD-17). Each request keeps the folded text of its product name
 * for the Orders list's search (migration 0019).
 */
import { searchText } from "@cashback/core";

import { assertTablesEmpty, sortByKey } from "../../platform/db/bulk-import";
import type { LedgerDb } from "../../platform/db/ledger";
import type { CommandAudit } from "../../platform/ports/audit.port";
import { shopeeProductKeyOf } from "./domain/product-url";
import { linkRequests, productOffers, shareCodes, type LinkRequestRow, type ProductOfferRow } from "./schema";

export type ImportedProductOffer = Omit<ProductOfferRow, "origin">;
export type ImportedLinkRequest = Omit<LinkRequestRow, "origin" | "searchText"> & { requestId: string; customerId: string };

export interface ImportedShareCode {
  code: string;
  requestId: string;
  createdAt: string | null;
}

export interface LinksImport {
  productOffers: readonly ImportedProductOffer[];
  linkRequests: readonly ImportedLinkRequest[];
  shareCodes: readonly ImportedShareCode[];
}

export interface LinksImportResult {
  productOffers: number;
  linkRequests: number;
  shareCodes: number;
}

export class LinksImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinksImportError";
  }
}

/** A share code as `/s/<code>` accepts it: 10 base62 characters, or a live 8-character code (AD-14). */
export const SHARE_CODE_PATTERN = /^(?:[A-Za-z0-9]{8}|[A-Za-z0-9]{10})$/;

export const isShareCode = (code: string): boolean => SHARE_CODE_PATTERN.test(code);

function refuseUnlessEmpty(db: LedgerDb): void {
  assertTablesEmpty(db, ["product_offers", "link_requests", "share_codes"], (table, n) => new LinksImportError(`links import needs empty tables; ${table} has ${n} rows`));
}

/** Imports links into empty tables; call inside `tx`. */
export function importLinks(db: LedgerDb, data: LinksImport, by: CommandAudit): LinksImportResult {
  refuseUnlessEmpty(db);
  for (const p of sortByKey(data.productOffers, (r) => r.productOfferId)) db.insert(productOffers).values({ ...p, origin: "CUTOVER" }).run();
  for (const r of sortByKey(data.linkRequests, (r) => r.requestId)) db.insert(linkRequests).values({ ...r, origin: "CUTOVER", searchText: searchText(r.productName), productKey: shopeeProductKeyOf(r.sourceUrl) }).run();
  for (const s of sortByKey(data.shareCodes, (r) => r.code)) {
    if (!isShareCode(s.code)) throw new LinksImportError(`not a share code: ${s.code}`);
    db.insert(shareCodes).values(s).run();
  }
  const result = { productOffers: data.productOffers.length, linkRequests: data.linkRequests.length, shareCodes: data.shareCodes.length };
  by.audit.record({ actor: by.actor, event: "linking.link_requests.imported", entityId: by.actor.id, payload: result });
  return result;
}
