/**
 * The network payouts tab's server calls (FR-19, D59, Story 4.21): the list on the list contract
 * and one payout's detail, both read only. A network payout is recorded by the operator's
 * machine on the internal listener, never from the desk.
 */
import { listSearch, NETWORK_SETTLEMENT_STATUSES, networkSettlementDetailSchema, networkSettlementListSchema, SETTLEMENT_MATCHES, SETTLEMENT_NETWORKS, type ListSearchState, type NetworkSettlementDetail, type NetworkSettlementList } from "@cashback/contracts";
import { useListQuery } from "@cashback/ui";
import { useQuery } from "@tanstack/react-query";

import { apiRequest } from "../api/api.queries";

export const NETWORK_SETTLEMENTS_KEY = ["admin", "network-settlements"] as const;

export const NETWORK_SETTLEMENTS_SEARCH = listSearch({
  sortable: ["network", "networkPayoutId", "status", "amount", "eligibleAmount", "matchedGross", "unattributed", "orderCount", "createdAt", "paidAt"],
  filters: [{ field: "status", values: NETWORK_SETTLEMENT_STATUSES }, { field: "network", values: SETTLEMENT_NETWORKS }, { field: "match", values: SETTLEMENT_MATCHES }, { field: "createdAt" }],
  defaultSort: { field: "createdAt", direction: "desc" },
});

export async function fetchNetworkSettlements(query: string, signal: AbortSignal): Promise<NetworkSettlementList> {
  return networkSettlementListSchema.parse(await apiRequest(`/api/admin/network-settlements?${query}`, { signal }));
}

/** The list; `paused` while a payout's orders are open, so the rows under the sheet stay put (LC-11). */
export function useNetworkSettlements(state: ListSearchState, paused: boolean) {
  return useListQuery({ key: NETWORK_SETTLEMENTS_KEY, search: NETWORK_SETTLEMENTS_SEARCH, state, fetchList: fetchNetworkSettlements, paused });
}

export function useNetworkSettlement(settlementId: number | null) {
  return useQuery({
    queryKey: [...NETWORK_SETTLEMENTS_KEY, "detail", settlementId],
    queryFn: async ({ signal }): Promise<NetworkSettlementDetail> => networkSettlementDetailSchema.parse(await apiRequest(`/api/admin/network-settlements/${settlementId}`, { signal })),
    enabled: settlementId !== null,
  });
}
