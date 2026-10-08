import { useEffect, useState } from "react";

import { createApiClient, type ApiTransfer } from "@mmo/contracts";

/** Data loading lives here, never inside a component (the coding rules). */
const api = createApiClient();

export interface TransfersState {
  transfers: ApiTransfer[];
  error: string;
}

export function useTransfers(): TransfersState {
  const [transfers, setTransfers] = useState<ApiTransfer[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .adminTransfers()
      .then(setTransfers)
      .catch((cause: Error) => setError(cause.message));
  }, []);
  return { transfers, error };
}
