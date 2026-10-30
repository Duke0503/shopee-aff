/**
 * The one list query (AD-12, LC-5, LC-8, LC-11). The query key carries the full API query, so
 * every distinct search is its own cache entry: a late response for an older query lands in its
 * own entry and is never shown for the current one. Previous rows stay as placeholder data while
 * the next query loads. Lists refetch on window focus and every 60 seconds while visible, unless
 * the caller pauses them (an open payout or review panel works on its snapshot).
 */
import { listQueryString, type ListResponse, type ListSearch, type ListSearchState } from "@cashback/contracts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

export const LIST_REFETCH_MS = 60_000;

/** Fetches one list query; a list may answer with more than the contract (`D`), such as tab totals. */
export type ListFetcher<R, D extends ListResponse<R> = ListResponse<R>> = (query: string, signal: AbortSignal) => Promise<D>;

export interface UseListQueryOptions<R, D extends ListResponse<R> = ListResponse<R>> {
  /** The list's own key, e.g. `["admin", "orders"]`; mutations invalidate by this prefix (LC-10). */
  readonly key: readonly unknown[];
  readonly search: ListSearch;
  readonly state: ListSearchState;
  readonly fetchList: ListFetcher<R, D>;
  readonly paused?: boolean;
}

export function useListQuery<R, D extends ListResponse<R> = ListResponse<R>>({ key, search, state, fetchList, paused = false }: UseListQueryOptions<R, D>) {
  const query = listQueryString(search, state);
  return useQuery({
    queryKey: [...key, query],
    queryFn: ({ signal }) => fetchList(query, signal),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: !paused,
    refetchInterval: paused ? false : LIST_REFETCH_MS,
    refetchIntervalInBackground: false,
  });
}
