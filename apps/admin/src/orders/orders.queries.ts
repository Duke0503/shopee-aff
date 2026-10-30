/**
 * The admin Orders list (FR-26, FR-37, Story 4.13) on the list contract: the URL search generated
 * from the same field names as the server's `orders.list.ts` (sortable fields, the status, the one
 * network filter and one date filter per date kind), the row shape from @cashback/contracts and
 * the one list query. The rows are read only: no order is changed from this screen.
 */
import { adminOrdersResponseSchema, listSearch, ORDER_DATE_FIELDS, ORDER_NETWORKS, type AdminOrderRow, type ListResponse, type ListSearchState, type OrderDateField } from "@cashback/contracts";
import { storedValues } from "@cashback/core";
import { useListQuery } from "@cashback/ui";

import { apiRequest } from "../api/api.queries";

export const ORDERS_KEY = ["admin", "orders"] as const;

export type OrderRow = AdminOrderRow;

export const ORDERS_SEARCH = listSearch({
  sortable: ["orderId", "customerCode", "customerName", "network", "status", "orderValue", "approvedCommission", "cashback", ...ORDER_DATE_FIELDS],
  filters: [{ field: "status", values: storedValues("order") }, { field: "network", values: ORDER_NETWORKS }, ...ORDER_DATE_FIELDS.map((field) => ({ field }))],
  defaultSort: { field: "recordedAt", direction: "desc" },
});

/** The date kind the screen shows: the one filtered on, else the one sorted by, else the recorded date. */
export function dateFieldOf(state: ListSearchState): OrderDateField {
  const filtered = ORDER_DATE_FIELDS.find((f) => (state.filters[f]?.length ?? 0) > 0);
  if (filtered !== undefined) return filtered;
  return ORDER_DATE_FIELDS.find((f) => f === state.sort.field) ?? "recordedAt";
}

export async function fetchOrders(query: string, signal: AbortSignal): Promise<ListResponse<OrderRow>> {
  return adminOrdersResponseSchema.parse(await apiRequest(`/api/admin/orders?${query}`, { signal }));
}

export function useOrdersList(state: ListSearchState) {
  return useListQuery({ key: ORDERS_KEY, search: ORDERS_SEARCH, state, fetchList: fetchOrders });
}
