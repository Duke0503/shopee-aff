/**
 * The sidebar's counts (wireframe sidebar badges): the Payouts "payable" tab and the open review
 * cases, from one small endpoint the shell polls once a minute. Its own query key, outside every
 * list's, so the poll never refetches a list (a list behind an open payout or review panel stays
 * paused, LC-11); a failed poll shows no badge rather than a wrong one.
 */
import { deskCountsSchema, type DeskCounts } from "@cashback/contracts";
import { useQuery } from "@tanstack/react-query";

import { apiRequest } from "../api/api.queries";

export const COUNTS_KEY = ["admin", "counts"] as const;
export const COUNTS_POLL_MS = 60_000;

export function useDeskCounts() {
  return useQuery({
    queryKey: COUNTS_KEY,
    queryFn: async ({ signal }): Promise<DeskCounts> => deskCountsSchema.parse(await apiRequest("/api/admin/counts", { signal })),
    refetchInterval: COUNTS_POLL_MS,
    staleTime: 30_000,
    retry: false,
  });
}

/** The count a navigation item shows, or null for none. */
export function countOf(counts: DeskCounts | undefined, itemId: string): number | null {
  if (counts === undefined) return null;
  const value = itemId === "payouts" ? counts.payable : itemId === "review" ? counts.openReviewCases : null;
  return value === null || value === 0 ? null : value;
}
