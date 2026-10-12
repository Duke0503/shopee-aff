import { useCallback, useEffect, useState } from "react";

import {
  createApiClient,
  type ApiPagination,
  type ApiRecordTransferInput,
  type ApiUserDetail,
  type ApiUserRow,
} from "@mmo/contracts";

/** Data loading lives here, never inside a component (the coding rules). */
const api = createApiClient();

export interface CustomersFilter {
  search: string;
  bank: "all" | "has_bank" | "no_bank";
  page: number;
}

export interface CustomersState {
  users: ApiUserRow[];
  pagination: ApiPagination | null;
  error: string;
}

/** The customer list for the chosen search, bank filter and page. */
export function useCustomers(filter: CustomersFilter): CustomersState {
  const { search, bank, page } = filter;
  const [state, setState] = useState<CustomersState>({ users: [], pagination: null, error: "" });

  useEffect(() => {
    let live = true;
    api
      .adminUsers({ search, bank, page })
      .then((result) => {
        if (live) setState({ users: result.users, pagination: result.pagination, error: "" });
      })
      .catch((cause: Error) => {
        if (live) setState({ users: [], pagination: null, error: cause.message });
      });
    return () => {
      live = false;
    };
  }, [search, bank, page]);

  return state;
}

export interface CustomerDetailState {
  detail: ApiUserDetail | null;
  error: string;
}

/**
 * One customer's whole page; bump `reloadKey` after a transfer changes it.
 *
 * A reload keeps the figures already on screen until the fresh ones arrive, so
 * the screen does not blank out (and the form's own "recorded" message stays).
 * Switching customer remounts the panel, so nothing stale is ever shown for a
 * different one.
 */
export function useCustomerDetail(
  customerId: string | null,
  reloadKey: number,
): CustomerDetailState {
  const [state, setState] = useState<CustomerDetailState>({ detail: null, error: "" });

  useEffect(() => {
    if (customerId === null) {
      setState({ detail: null, error: "" });
      return;
    }
    let live = true;
    api
      .adminUserDetail(customerId)
      .then((detail) => {
        if (live) setState({ detail, error: "" });
      })
      .catch((cause: Error) => {
        if (live) setState({ detail: null, error: cause.message });
      });
    return () => {
      live = false;
    };
  }, [customerId, reloadKey]);

  return state;
}

export interface TransferState {
  busy: boolean;
  error: string;
  /** Set once the server has recorded a transfer; the amount is ITS figure. */
  recordedVnd: number | null;
  record: (input: ApiRecordTransferInput) => Promise<boolean>;
}

export function useRecordTransfer(): TransferState {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recordedVnd, setRecordedVnd] = useState<number | null>(null);

  const record = useCallback(async (input: ApiRecordTransferInput): Promise<boolean> => {
    setBusy(true);
    setError("");
    try {
      const result = await api.recordTransfer(input);
      setRecordedVnd(result.amountVnd);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, error, recordedVnd, record };
}
