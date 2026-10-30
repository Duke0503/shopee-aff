/**
 * The admin Orders list (FR-26, FR-37) on the list contract. The server side,
 * `GET /api/admin/orders` from `orders.list.ts`, is Story 4.13; this file is the client half:
 * the URL search generated from the same field names, the row shape and the one list query.
 * Until the endpoint exists the screen shows the list error state, never an empty list.
 */
import { listResponseSchema, listSearch, type ListResponse, type ListSearchState } from "@cashback/contracts";
import { storedValues } from "@cashback/core";
import { useListQuery } from "@cashback/ui";
import { z } from "zod";

import { apiRequest } from "../api/api.queries";

export const ORDERS_KEY = ["admin", "orders"] as const;

export const ORDERS_SEARCH = listSearch({
  sortable: ["customerName", "status", "cashback", "recordedAt"],
  filters: [{ field: "status", values: storedValues("order") }],
  defaultSort: { field: "recordedAt", direction: "desc" },
});

const orderRowSchema = z.object({
  orderId: z.string(),
  customerCode: z.string().nullable(),
  customerName: z.string().nullable(),
  productName: z.string().nullable(),
  /** The product snapshot's image (D56), https only; null when the snapshot has none. */
  productImageUrl: z.url({ protocol: /^https$/ }).nullable(),
  network: z.string(),
  status: z.string(),
  /** Stored whole dong; null while the order has no approved cashback yet. */
  cashback: z.number().int().nullable(),
  recordedAt: z.string(),
});
export type OrderRow = z.infer<typeof orderRowSchema>;

const ordersResponseSchema = listResponseSchema(orderRowSchema);

export async function fetchOrders(query: string, signal: AbortSignal): Promise<ListResponse<OrderRow>> {
  return ordersResponseSchema.parse(await apiRequest(`/api/admin/orders?${query}`, { signal }));
}

export function useOrdersList(state: ListSearchState) {
  return useListQuery({ key: ORDERS_KEY, search: ORDERS_SEARCH, state, fetchList: fetchOrders });
}
