import { useEffect, useState } from "react";

import { createApiClient, type ApiOrder } from "@mmo/contracts";

/** Data loading lives here, never inside a component (the coding rules). */
const api = createApiClient();

export interface MyOrdersState {
  orders: ApiOrder[];
  error: string;
}

export function useMyOrders(): MyOrdersState {
  const [orders, setOrders] = useState<ApiOrder[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .myOrders()
      .then(setOrders)
      .catch((cause: Error) => setError(cause.message));
  }, []);
  return { orders, error };
}
