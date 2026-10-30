/**
 * A DataList on a real QueryClient with a fake list endpoint: every request is recorded and
 * answered by a function the test controls, so tests can hold, fail or reorder responses.
 * The list state lives in a plain React state here; the admin desk keeps it in the URL.
 */
import { listSearch, type ListResponse, type ListSearchState } from "@cashback/contracts";
import { storedValues } from "@cashback/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { useState } from "react";

import { DataList, useListQuery, type DataListProps, type ListColumn } from "../src/index";

export interface OrderRow {
  readonly orderId: string;
  readonly customerCode: string;
  readonly customerName: string;
  readonly product: string;
  readonly productImageUrl: string | null;
  readonly network: string;
  readonly status: string;
  readonly cashback: number | null;
  readonly recordedAt: string;
}

export const ORDER_SEARCH = listSearch({
  sortable: ["customerName", "status", "cashback", "recordedAt"],
  filters: [{ field: "status", values: storedValues("order") }, { field: "network", values: ["shopee", "accesstrade"] }, { field: "recordedAt" }, { field: "approvedAt" }],
  defaultSort: { field: "recordedAt", direction: "desc" },
});

export const ORDER_COLUMNS: readonly ListColumn<OrderRow>[] = [
  { key: "orderId", header: "Order", kind: "code", card: "meta" },
  { key: "customerCode", header: "Customer code", kind: "code", card: "who" },
  { key: "customerName", header: "Customer", kind: "name", sortable: true, card: "who" },
  { key: "product", header: "Product", kind: "product", imageKey: "productImageUrl", card: "title", desktopOnly: true },
  { key: "network", header: "Network", kind: "text", card: "meta" },
  { key: "status", header: "Status", kind: "status", entity: "order", sortable: true, card: "status" },
  { key: "cashback", header: "Cashback", kind: "money", sortable: true, card: "amount" },
  { key: "recordedAt", header: "Recorded", kind: "instant", sortable: true, card: "meta", cardLabel: "Rec." },
];

export function orderRow(n: number, overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    orderId: `2610${String(n).padStart(6, "0")}`,
    customerCode: `DP${String(n).padStart(5, "0")}`,
    customerName: `Customer ${n}`,
    product: `Product ${n}`,
    productImageUrl: n % 2 === 0 ? `https://cf.example.test/file/p${n}.jpg` : null,
    network: "Shopee",
    status: "APPROVED",
    cashback: 9263 + n,
    recordedAt: "2026-10-30T05:00:00.000Z",
    ...overrides,
  };
}

export function listOf(rows: readonly OrderRow[], extra: Partial<ListResponse<OrderRow>> = {}): ListResponse<OrderRow> {
  return {
    rows: [...rows],
    total: rows.length,
    page: 1,
    pageSize: 25,
    facets: { status: [{ value: "AWAITING_APPROVAL", count: 0 }, { value: "FROZEN", count: 0 }, { value: "APPROVED", count: rows.length }, { value: "REVERSED", count: 0 }, { value: "PAID", count: 0 }, { value: "REJECTED", count: 0 }] },
    summary: { cashback: 0 },
    asOf: "2026-10-30T12:42:00.000Z",
    ...extra,
  };
}

export type Responder = (query: string) => Promise<ListResponse<OrderRow>>;

export interface Harness {
  readonly requests: string[];
  readonly states: ListSearchState[];
  readonly replaced: boolean[];
}

export function renderList(respond: Responder, initial: Partial<ListSearchState> = {}, filters?: DataListProps<OrderRow>["filters"]) {
  const harness: Harness = { requests: [], states: [], replaced: [] };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  function Screen() {
    const [state, setState] = useState<ListSearchState>({ ...ORDER_SEARCH.defaults, ...initial });
    const query = useListQuery({
      key: ["test", "orders"],
      search: ORDER_SEARCH,
      state,
      fetchList: (q) => {
        harness.requests.push(q);
        return respond(q);
      },
    });
    return (
      <DataList
        search={ORDER_SEARCH}
        state={state}
        onStateChange={(next, options) => {
          harness.states.push(next);
          harness.replaced.push(options?.replace === true);
          setState(next);
        }}
        query={query}
        columns={ORDER_COLUMNS}
        rowKey={(row) => row.orderId}
        searchPlaceholder="Search order id, customer"
        countLabel={(count) => `${count} orders`}
        emptyText="No orders yet."
        statusFilter={{ field: "status", entity: "order" }}
        summary={[{ key: "cashback", label: "Cashback" }]}
        {...(filters === undefined ? {} : { filters })}
      />
    );
  }
  const view = render(
    <QueryClientProvider client={client}>
      <Screen />
    </QueryClientProvider>,
  );
  return { ...view, harness, client };
}

/** A promise the test resolves or rejects later. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
