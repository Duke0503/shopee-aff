import { useCallback, useEffect, useState } from "react";

import {
  createApiClient,
  type ApiAdminOrder,
  type ApiAdminOrdersQuery,
  type ApiPagination,
} from "@mmo/contracts";

/** Data loading lives here, never inside a component (the coding rules). */
const api = createApiClient();

export interface OrdersFilter {
  search: string;
  status: string;
  platform: string;
  settlement: string;
  fromDate: string;
  toDate: string;
  /** `""` is newest first, the server's own order. */
  sort: string;
  page: number;
}

export interface OrdersState {
  orders: ApiAdminOrder[];
  pagination: ApiPagination | null;
  error: string;
}

/** Only the filters that were chosen are sent; `all` means "no filter". */
function queryOf(filter: Omit<OrdersFilter, "page">): ApiAdminOrdersQuery {
  return {
    search: filter.search,
    status: filter.status,
    platform: filter.platform,
    settlementStatus: filter.settlement,
    fromDate: filter.fromDate,
    toDate: filter.toDate,
    sortBy: filter.sort === "" ? undefined : filter.sort,
    sortOrder: filter.sort === "" ? undefined : "desc",
  };
}

/** The order list for the chosen filters and page. */
export function useOrders(filter: OrdersFilter, reloadKey = 0): OrdersState {
  const { search, status, platform, settlement, fromDate, toDate, sort, page } = filter;
  const [state, setState] = useState<OrdersState>({ orders: [], pagination: null, error: "" });

  useEffect(() => {
    let live = true;
    api
      .adminOrders({ ...queryOf({ search, status, platform, settlement, fromDate, toDate, sort }), page })
      .then((result) => {
        if (live) setState({ orders: result.orders, pagination: result.pagination, error: "" });
      })
      .catch((cause: Error) => {
        if (live) setState({ orders: [], pagination: null, error: cause.message });
      });
    return () => {
      live = false;
    };
  }, [search, status, platform, settlement, fromDate, toDate, sort, page, reloadKey]);

  return state;
}

export interface MarkPaidState {
  /** The order being marked right now, so only its own button shows busy. */
  busyOrderId: string | null;
  error: string;
  /** Records that the money left. The server re-checks approved and unpaid. */
  mark: (customerId: string, orderId: string) => Promise<boolean>;
}

export function useMarkPaid(): MarkPaidState {
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const mark = useCallback(async (customerId: string, orderId: string): Promise<boolean> => {
    setBusyOrderId(orderId);
    setError("");
    try {
      const result = await api.markOrdersPaid({ customerId, orderIds: [orderId] });
      if (!result.ok) {
        setError(result.message ?? "");
        return false;
      }
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusyOrderId(null);
    }
  }, []);

  return { busyOrderId, error, mark };
}
