import { useEffect, useState } from "react";

import { createApiClient, type ApiOrder } from "@mmo/contracts";

/** Data loading lives here, never inside a component (the coding rules). */
const api = createApiClient();

export interface OrdersState {
  orders: ApiOrder[];
  error: string;
}

export function useOrders(status?: string): OrdersState {
  const [orders, setOrders] = useState<ApiOrder[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .adminOrders(status)
      .then(setOrders)
      .catch((cause: Error) => setError(cause.message));
  }, [status]);
  return { orders, error };
}
