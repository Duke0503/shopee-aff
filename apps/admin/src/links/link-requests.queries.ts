/**
 * The desk's link requests list (FR-7, FR-37, Story 5.10) on the list contract: the URL search
 * generated from the same field names as the server's `link-requests-desk.list.ts` (sortable
 * fields, the state, the channel and network filters and one date filter on the request time), the
 * row shape from @cashback/contracts and the one list query. Read only.
 */
import { DESK_LINK_REQUEST_NETWORKS, DESK_LINK_REQUESTS_PATH, deskLinkRequestsResponseSchema, LINK_REQUEST_CHANNELS, listSearch, type DeskLinkRequestRow, type ListResponse, type ListSearchState } from "@cashback/contracts";
import { storedValues } from "@cashback/core";
import { useListQuery } from "@cashback/ui";

import { apiRequest } from "../api/api.queries";

export const LINK_REQUESTS_KEY = ["admin", "link-requests"] as const;

export type LinkRequestRow = DeskLinkRequestRow;

export const LINK_REQUESTS_SEARCH = listSearch({
  sortable: ["requestId", "customerCode", "productName", "network", "channel", "status", "attempts", "deliveredAt", "createdAt"],
  filters: [{ field: "status", values: storedValues("linkRequest") }, { field: "channel", values: LINK_REQUEST_CHANNELS }, { field: "network", values: DESK_LINK_REQUEST_NETWORKS }, { field: "createdAt" }, { field: "deliveredAt" }],
  defaultSort: { field: "createdAt", direction: "desc" },
});

export async function fetchLinkRequests(query: string, signal: AbortSignal): Promise<ListResponse<LinkRequestRow>> {
  return deskLinkRequestsResponseSchema.parse(await apiRequest(`${DESK_LINK_REQUESTS_PATH}?${query}`, { signal }));
}

export function useLinkRequestsList(state: ListSearchState) {
  return useListQuery({ key: LINK_REQUESTS_KEY, search: LINK_REQUESTS_SEARCH, state, fetchList: fetchLinkRequests });
}
