/**
 * One customer's link requests on the desk (FR-26, FR-37, AD-12; Story 4.14): every request the
 * customer made, newest first, on the list contract, scoped by the server to the customer's stored
 * ids (the survivor and its aliases); `customerId` is not a URL filter, so a browser cannot widen
 * the scope. One value per column: the request id, the product snapshot (D56, https images only),
 * the network, the status in lifecycle order and the time it was made. Search covers the
 * snapshot's product name (link_requests.search_text, migration 0019). The count is the exact
 * total, never capped (list-defects "link counts capped at 100 read as totals").
 */
import type { AdminLinkRequestRow, ListResponse } from "@cashback/contracts";
import type { Clock } from "@cashback/core";
import { inArray, sql } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { defineList } from "../../platform/list/define-list";
import { answerScopedList } from "../../platform/list/list-request";
import { httpsImageUrl } from "./product-snapshot.query";
import { linkRequests } from "./schema";

export const LINK_REQUESTS_LIST = defineList({
  from: "link_requests l",
  key: "l.request_id",
  fields: {
    requestId: { kind: "text", column: "l.request_id", sortable: true },
    customerId: { kind: "text", column: "l.customer_id" },
    productName: { kind: "text", column: "l.product_name", sortable: true },
    productImageUrl: { kind: "text", column: "l.product_image_url" },
    network: { kind: "text", column: "l.network", sortable: true, filter: true, facet: true },
    status: {
      kind: "status",
      entity: "linkRequest",
      column: "l.status",
      sortable: true,
      filter: true,
      facet: true,
    },
    createdAt: { kind: "instant", column: "l.created_at", sortable: true, filter: true },
  },
  search: ["l.search_text"],
  defaultSort: { field: "createdAt", direction: "desc" },
});

/** One page of a customer's link requests; a refused query is the list error envelope. */
export function answerCustomerLinkRequests(
  db: LedgerDb,
  customerIds: readonly string[],
  raw: unknown,
  clock: Clock,
): ListResponse<AdminLinkRequestRow> {
  const page = answerScopedList<typeof LINK_REQUESTS_LIST.fields, AdminLinkRequestRow>(
    db,
    LINK_REQUESTS_LIST,
    raw,
    clock,
    [{ field: "customerId", kind: "in", values: customerIds }],
  );
  return {
    ...page,
    rows: page.rows.map((r) => ({ ...r, productImageUrl: httpsImageUrl(r.productImageUrl) })),
  };
}

/** How many link requests the stored ids hold together. */
export function linkRequestCountOf(db: LedgerDb, customerIds: readonly string[]): number {
  if (customerIds.length === 0) return 0;
  return (
    db
      .select({ count: sql<number>`count(*)` })
      .from(linkRequests)
      .where(inArray(linkRequests.customerId, [...customerIds]))
      .get()?.count ?? 0
  );
}
