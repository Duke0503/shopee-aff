import { useEffect, useState } from "react";

import { createApiClient, type ApiCustomerProfile } from "@mmo/contracts";

/** Data loading lives here, never inside a component (the coding rules). */
const api = createApiClient();

export interface CustomersState {
  customers: ApiCustomerProfile[];
  error: string;
}

export function useCustomers(query?: string): CustomersState {
  const [customers, setCustomers] = useState<ApiCustomerProfile[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .adminCustomers(query)
      .then(setCustomers)
      .catch((cause: Error) => setError(cause.message));
  }, [query]);
  return { customers, error };
}
