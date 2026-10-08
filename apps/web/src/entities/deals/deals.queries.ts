import { useEffect, useState } from "react";

import { createApiClient, type ApiDeal } from "@mmo/contracts";

/** Data loading lives here, never inside a component (the coding rules). */
const api = createApiClient();

export interface DealsState {
  deals: ApiDeal[];
  error: string;
}

export function useDeals(): DealsState {
  const [deals, setDeals] = useState<ApiDeal[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .deals()
      .then(setDeals)
      .catch((cause: Error) => setError(cause.message));
  }, []);
  return { deals, error };
}
