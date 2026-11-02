/**
 * My money's server reads (Stories 7.3 and 7.4, code.md §10): the balance card, the order lines
 * and the payouts of the signed-in customer. The session cookie names the customer; nothing here
 * sends an id. The URL state is in money-search.ts.
 */
import {
  MY_MONEY_PATH,
  MY_ORDERS_PATH,
  MY_PAYOUTS_PATH,
  myMoneySchema,
  myOrdersResponseSchema,
  myPayoutsResponseSchema,
  type ListResponse,
  type ListSearchState,
  type MyMoney,
  type MyOrderRow,
  type MyPayoutRow,
} from "@cashback/contracts";
import { ListFetchError, useListQuery } from "@cashback/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, apiRequest, isUnauthorized } from "../api/api.queries";
import { MONEY_KEY, SESSION_KEY } from "../session/session.queries";
import { MY_ORDERS_SEARCH, MY_PAYOUTS_SEARCH } from "./money-search";

export { MONEY_KEY };

/**
 * A read of the customer's data. A 401 means the session ended since the page opened (a new
 * password, a sign-out in another tab): the cached session is cleared and asked again, so the page shows the sign-in
 * form instead of an error. A list's failure is worded by the list states.
 */
function useCustomerRead() {
  const client = useQueryClient();
  return async (path: string, signal: AbortSignal, list: boolean): Promise<unknown> => {
    try {
      return await apiRequest(path, { signal });
    } catch (error) {
      if (isUnauthorized(error)) void client.resetQueries({ queryKey: SESSION_KEY, exact: true });
      if (list && error instanceof ApiError) throw new ListFetchError(error.status);
      throw error;
    }
  };
}

export function useMyMoney() {
  const read = useCustomerRead();
  return useQuery({
    queryKey: MONEY_KEY,
    queryFn: async ({ signal }): Promise<MyMoney> => myMoneySchema.parse(await read(MY_MONEY_PATH, signal, false)),
    retry: (failures, error) => !isUnauthorized(error) && failures < 1,
  });
}

export function useMyOrders(state: ListSearchState) {
  const read = useCustomerRead();
  return useListQuery({
    key: [...MONEY_KEY, "orders"],
    search: MY_ORDERS_SEARCH,
    state,
    fetchList: async (query, signal): Promise<ListResponse<MyOrderRow>> => myOrdersResponseSchema.parse(await read(`${MY_ORDERS_PATH}?${query}`, signal, true)),
  });
}

export function useMyPayouts(state: ListSearchState) {
  const read = useCustomerRead();
  return useListQuery({
    key: [...MONEY_KEY, "payouts"],
    search: MY_PAYOUTS_SEARCH,
    state,
    fetchList: async (query, signal): Promise<ListResponse<MyPayoutRow>> => myPayoutsResponseSchema.parse(await read(`${MY_PAYOUTS_PATH}?${query}`, signal, true)),
  });
}
