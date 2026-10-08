import { useEffect, useState } from "react";

import { createApiClient, type ApiBalance } from "@mmo/contracts";

/** Data loading lives here, never inside a component (the coding rules). */
const api = createApiClient();

export interface BalanceState {
  balance: ApiBalance | null;
  error: string;
}

export function useBalance(): BalanceState {
  const [balance, setBalance] = useState<ApiBalance | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .balance()
      .then(setBalance)
      .catch((cause: Error) => setError(cause.message));
  }, []);
  return { balance, error };
}
