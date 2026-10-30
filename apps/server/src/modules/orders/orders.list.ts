/**
 * The Orders list (FR-26, FR-37, FR-38, AD-12, AD-4; Story 4.13): every order on the list
 * contract, joined read-only to the customer (its stored search_text and sort_key) and to the link
 * request's product snapshot (D56). One value per column: the customer code and name apart, one
 * date kind per column (recorded, approved, paid), each with its own Vietnam-day filter; money
 * columns are the stored values (approved commission, cashback), so a sort on "commission" or
 * "cashback" orders by exactly the figure shown and never by the estimate (list-defects Orders).
 * There is one network filter. Search covers the order id (orders.search_text, migration 0016),
 * the customer's code, name and Zalo id (customers.search_text) and the product name of the link's
 * snapshot (link_requests.search_text, migration 0019), folded and escaped by packages/core/text,
 * never the raw estimate or report JSON. The status chips' counts come from the same filtered set; the overall
 * total is answered separately and shown labelled as such. Nothing here writes: there is no
 * action on an order row, and the only way to PAID is a payout confirm.
 *
 * A customer's page lists the same rows scoped by the server to the customer's stored ids (the
 * survivor and its aliases, Story 4.14); `customerId` is not a URL filter, so the scope cannot be
 * widened or swapped from the browser.
 */
import type { AdminOrderRow, ListResponse } from "@cashback/contracts";
import type { Clock } from "@cashback/core";

import type { LedgerDb } from "../../platform/db/ledger";
import { defineList } from "../../platform/list/define-list";
import { answerList, answerScopedList } from "../../platform/list/list-request";
import { httpsImageUrl } from "../linking/index";

export const ORDERS_LIST = defineList({
  from: "orders o LEFT JOIN customers c ON c.customer_id = o.customer_id LEFT JOIN link_requests l ON l.request_id = o.request_id",
  key: "o.order_id",
  fields: {
    orderId: { kind: "text", column: "o.order_id", sortable: true },
    customerId: { kind: "text", column: "o.customer_id" },
    customerCode: { kind: "text", column: "c.customer_code", sortable: true },
    customerName: { kind: "name", column: "c.display_name", sortKeyColumn: "c.sort_key", sortable: true },
    productName: { kind: "text", column: "l.product_name" },
    productImageUrl: { kind: "text", column: "l.product_image_url" },
    network: { kind: "text", column: "o.network", sortable: true, filter: true, facet: true },
    status: { kind: "status", entity: "order", column: "o.status", sortable: true, filter: true, facet: true },
    orderValue: { kind: "money", column: "o.order_value", sortable: true },
    approvedCommission: { kind: "money", column: "o.approved_commission", sortable: true, summary: true },
    cashback: { kind: "money", column: "o.cashback", sortable: true, summary: true },
    recordedAt: { kind: "instant", column: "o.recorded_at", sortable: true, filter: true },
    approvedAt: { kind: "instant", column: "o.approved_at", sortable: true, filter: true },
    paidAt: { kind: "instant", column: "o.paid_at", sortable: true, filter: true },
    settledBy: { kind: "text", column: "o.network_batch_id" },
  },
  search: ["o.search_text", "c.search_text", "l.search_text"],
  defaultSort: { field: "recordedAt", direction: "desc" },
  overallTotal: true,
});

type Row = Omit<AdminOrderRow, "productImageUrl"> & { productImageUrl: string | null };

// The desk loads only https images (D56): any other snapshot URL is dropped, never shown.
const httpsOnly = (page: ListResponse<Row>): ListResponse<AdminOrderRow> => ({ ...page, rows: page.rows.map((r) => ({ ...r, productImageUrl: httpsImageUrl(r.productImageUrl) })) });

/** One page of the Orders list for a raw query; a refused query is the list error envelope. */
export function answerOrdersList(db: LedgerDb, raw: unknown, clock: Clock): ListResponse<AdminOrderRow> {
  return httpsOnly(answerList<typeof ORDERS_LIST.fields, Row>(db, ORDERS_LIST, raw, clock));
}

/** One customer's orders: the Orders list scoped to the stored ids the server resolved (Story 4.14). */
export function answerCustomerOrders(db: LedgerDb, customerIds: readonly string[], raw: unknown, clock: Clock): ListResponse<AdminOrderRow> {
  return httpsOnly(answerScopedList<typeof ORDERS_LIST.fields, Row>(db, ORDERS_LIST, raw, clock, [{ field: "customerId", kind: "in", values: customerIds }]));
}
