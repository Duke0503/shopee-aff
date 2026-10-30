/**
 * The payout history's server call (FR-17, FR-34, Story 4.12): GET /api/admin/payout-history on
 * the list contract, its URL search generated from the server's field names. A void refreshes it
 * with every other desk query (payout-record.queries.ts, LC-10).
 */
import { listSearch, payoutHistoryResponseSchema, type ListSearchState, type PayoutHistoryResponse } from "@cashback/contracts";
import { storedValues } from "@cashback/core";
import { useListQuery } from "@cashback/ui";

import { apiRequest } from "../api/api.queries";

export const PAYOUT_HISTORY_KEY = ["admin", "payout-history"] as const;

export const PAYOUT_HISTORY_SEARCH = listSearch({
  sortable: ["payoutId", "customerCode", "customerName", "amount", "status", "recordedAt", "recordedBy"],
  filters: [{ field: "status", values: storedValues("payout") }, { field: "recordedAt" }],
  defaultSort: { field: "recordedAt", direction: "desc" },
});

/** The public receipt of a payout, /b/<token>, served on every host of the one listener. */
export const receiptPath = (token: string): string => `/b/${encodeURIComponent(token)}`;

export async function fetchPayoutHistory(query: string, signal: AbortSignal): Promise<PayoutHistoryResponse> {
  return payoutHistoryResponseSchema.parse(await apiRequest(`/api/admin/payout-history?${query}`, { signal }));
}

export function usePayoutHistory(state: ListSearchState) {
  return useListQuery({ key: PAYOUT_HISTORY_KEY, search: PAYOUT_HISTORY_SEARCH, state, fetchList: fetchPayoutHistory });
}
