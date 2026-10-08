import { useEffect, useState } from "react";

import { createApiClient, type ApiPayables } from "@mmo/contracts";

/** Data loading lives here, never inside a component (the coding rules). */
const api = createApiClient();

export interface PayoutsState {
  data: ApiPayables | null;
  error: string;
}

export function usePayouts(): PayoutsState {
  const [data, setData] = useState<ApiPayables | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .payouts()
      .then(setData)
      .catch((cause: Error) => setError(cause.message));
  }, []);
  return { data, error };
}
