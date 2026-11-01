/**
 * The desk's link requests list (FR-7, FR-25, FR-37, AD-12; Story 5.10): every link request on the
 * list contract, joined read-only to the requester (identity's customers: code, role, search_text),
 * so staff can see failed links from the Overview and help the customer. Filters by state and
 * channel, with counts from facets over the same filtered set; the "requested" column is the
 * request's own time, sorted by that same field (regression "last requested sorts by update time").
 * A guest request (HOUSE) is listed as the guest account, never as a customer (D5). Search covers
 * the stored search texts only: the snapshot's product name and the requester's code and name. Nothing here
 * writes. The fuller list with actions comes after cutover (Story 9.9).
 */
import type { DeskLinkRequestRow, ListResponse } from "@cashback/contracts";
import type { Clock } from "@cashback/core";

import type { LedgerDb } from "../../platform/db/ledger";
import { defineList } from "../../platform/list/define-list";
import { answerList } from "../../platform/list/list-request";
import { httpsImageUrl } from "./product-snapshot.query";

export const DESK_LINK_REQUESTS_LIST = defineList({
  from: "link_requests l LEFT JOIN customers c ON c.customer_id = l.customer_id",
  key: "l.request_id",
  fields: {
    requestId: { kind: "text", column: "l.request_id", sortable: true },
    customerCode: { kind: "text", column: "c.customer_code", sortable: true },
    customerRole: { kind: "text", column: "c.role" },
    productName: { kind: "text", column: "l.product_name", sortable: true },
    productImageUrl: { kind: "text", column: "l.product_image_url" },
    network: { kind: "text", column: "l.network", sortable: true, filter: true, facet: true },
    platform: { kind: "text", column: "l.platform" },
    channel: { kind: "text", column: "l.channel", sortable: true, filter: true, facet: true },
    status: { kind: "status", entity: "linkRequest", column: "l.status", sortable: true, filter: true, facet: true },
    attempts: { kind: "integer", column: "l.attempts", sortable: true },
    deliveredAt: { kind: "instant", column: "l.delivered_at", sortable: true, filter: true },
    createdAt: { kind: "instant", column: "l.created_at", sortable: true, filter: true },
  },
  search: ["l.search_text", "c.search_text"],
  defaultSort: { field: "createdAt", direction: "desc" },
  overallTotal: true,
});

type Row = Omit<DeskLinkRequestRow, "guest" | "productImageUrl"> & { customerRole: string | null; productImageUrl: string | null };

/** One page of every link request for a raw query; a refused query is the list error envelope. */
export function answerDeskLinkRequests(db: LedgerDb, raw: unknown, clock: Clock): ListResponse<DeskLinkRequestRow> {
  const page = answerList<typeof DESK_LINK_REQUESTS_LIST.fields, Row>(db, DESK_LINK_REQUESTS_LIST, raw, clock);
  return {
    ...page,
    rows: page.rows.map(({ customerRole, ...r }) => {
      const guest = customerRole === "HOUSE";
      return { ...r, customerCode: guest ? null : r.customerCode, guest, productImageUrl: httpsImageUrl(r.productImageUrl) };
    }),
  };
}
