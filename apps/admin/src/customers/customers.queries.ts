/**
 * The Customers screen and one customer's page (FR-26, FR-15, FR-37, Story 4.14): the list on the
 * list contract, the page's own figures, and the page's three tab lists (orders, link requests,
 * payouts), each its own list endpoint scoped by the server to that customer. Every query of one
 * customer carries the customer's key, so opening another customer can never show the previous
 * one's figures (list-defects `UserDetailDialog.tsx:85`). Everything here is read only; a payout,
 * a void or a review apply invalidates `CUSTOMERS_KEY`, which covers the list and every page.
 */
import {
  adminCustomersResponseSchema,
  adminLinkRequestsResponseSchema,
  adminOrdersResponseSchema,
  CUSTOMER_BANK_STATES,
  customerPageSchema,
  LINK_REQUEST_NETWORKS,
  listSearch,
  ORDER_DATE_FIELDS,
  ORDER_NETWORKS,
  payoutHistoryResponseSchema,
  YES_NO,
  type AdminCustomerRow,
  type AdminLinkRequestRow,
  type CustomerPage,
  type ListResponse,
  type ListSearchState,
  type PayoutHistoryRow,
} from "@cashback/contracts";
import { storedValues } from "@cashback/core";
import { useListQuery } from "@cashback/ui";
import { useQuery } from "@tanstack/react-query";

import { apiRequest } from "../api/api.queries";
import type { OrderRow } from "../orders/orders.queries";

export const CUSTOMERS_KEY = ["admin", "customers"] as const;

export const CUSTOMERS_SEARCH = listSearch({
  sortable: ["customerCode", "customerName", "bankName", "orderCount", "payable", "paid"],
  filters: [
    { field: "owed", values: YES_NO },
    { field: "flagged", values: YES_NO },
    { field: "bank", values: CUSTOMER_BANK_STATES },
  ],
  defaultSort: { field: "payable", direction: "desc" },
});

export async function fetchCustomers(
  query: string,
  signal: AbortSignal,
): Promise<ListResponse<AdminCustomerRow>> {
  return adminCustomersResponseSchema.parse(
    await apiRequest(`/api/admin/customers?${query}`, { signal }),
  );
}

export function useCustomersList(state: ListSearchState) {
  return useListQuery({
    key: CUSTOMERS_KEY,
    search: CUSTOMERS_SEARCH,
    state,
    fetchList: fetchCustomers,
  });
}

const customerPath = (key: string): string => `/api/admin/customers/${encodeURIComponent(key)}`;

export function useCustomerPage(key: string) {
  return useQuery({
    queryKey: [...CUSTOMERS_KEY, "page", key],
    queryFn: async ({ signal }): Promise<CustomerPage> =>
      customerPageSchema.parse(await apiRequest(customerPath(key), { signal })),
  });
}

/** The tabs of a customer's page; the first is the default and is left out of the URL. */
export const CUSTOMER_TABS = ["orders", "links", "payouts"] as const;
export type CustomerTab = (typeof CUSTOMER_TABS)[number];

export const tabOf = (raw: unknown): CustomerTab =>
  (CUSTOMER_TABS as readonly unknown[]).includes(raw) ? (raw as CustomerTab) : "orders";

/** The same fields as the Orders list; the server scopes it to the customer. */
export const CUSTOMER_ORDERS_SEARCH = listSearch({
  sortable: [
    "orderId",
    "status",
    "orderValue",
    "approvedCommission",
    "cashback",
    ...ORDER_DATE_FIELDS,
  ],
  filters: [
    { field: "status", values: storedValues("order") },
    { field: "network", values: ORDER_NETWORKS },
    ...ORDER_DATE_FIELDS.map((field) => ({ field })),
  ],
  defaultSort: { field: "recordedAt", direction: "desc" },
});

export const CUSTOMER_LINKS_SEARCH = listSearch({
  sortable: ["requestId", "productName", "network", "status", "createdAt"],
  filters: [
    { field: "status", values: storedValues("linkRequest") },
    { field: "network", values: LINK_REQUEST_NETWORKS },
    { field: "createdAt" },
  ],
  defaultSort: { field: "createdAt", direction: "desc" },
});

export const CUSTOMER_PAYOUTS_SEARCH = listSearch({
  sortable: ["amount", "status", "recordedAt", "recordedBy"],
  filters: [{ field: "status", values: storedValues("payout") }, { field: "recordedAt" }],
  defaultSort: { field: "recordedAt", direction: "desc" },
});

export const TAB_SEARCH = {
  orders: CUSTOMER_ORDERS_SEARCH,
  links: CUSTOMER_LINKS_SEARCH,
  payouts: CUSTOMER_PAYOUTS_SEARCH,
} as const;

const tabKey = (key: string, tab: CustomerTab) => [...CUSTOMERS_KEY, "page", key, tab] as const;

export function useCustomerOrders(key: string, state: ListSearchState) {
  const fetchList = async (query: string, signal: AbortSignal): Promise<ListResponse<OrderRow>> =>
    adminOrdersResponseSchema.parse(
      await apiRequest(`${customerPath(key)}/orders?${query}`, { signal }),
    );
  return useListQuery({
    key: tabKey(key, "orders"),
    search: CUSTOMER_ORDERS_SEARCH,
    state,
    fetchList,
  });
}

export function useCustomerLinks(key: string, state: ListSearchState) {
  const fetchList = async (
    query: string,
    signal: AbortSignal,
  ): Promise<ListResponse<AdminLinkRequestRow>> =>
    adminLinkRequestsResponseSchema.parse(
      await apiRequest(`${customerPath(key)}/link-requests?${query}`, { signal }),
    );
  return useListQuery({
    key: tabKey(key, "links"),
    search: CUSTOMER_LINKS_SEARCH,
    state,
    fetchList,
  });
}

export function useCustomerPayouts(key: string, state: ListSearchState) {
  const fetchList = async (
    query: string,
    signal: AbortSignal,
  ): Promise<ListResponse<PayoutHistoryRow>> =>
    payoutHistoryResponseSchema.parse(
      await apiRequest(`${customerPath(key)}/payouts?${query}`, { signal }),
    );
  return useListQuery({
    key: tabKey(key, "payouts"),
    search: CUSTOMER_PAYOUTS_SEARCH,
    state,
    fetchList,
  });
}
