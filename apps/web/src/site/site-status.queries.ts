/**
 * Whether the Zalo assistant is down and where customers reach the operator meanwhile (FR-36,
 * Story 7.1). Read on every page load and every navigation, and again every minute while a page
 * stays open, so the banner appears and goes with the server's answer. While the answer is not
 * known yet (first load, or the server unreachable) the assistant counts as up: the banner shows
 * only on the server's word.
 */
import { SITE_STATUS_PATH, siteStatusResponseSchema, type SiteStatusResponse } from "@cashback/contracts";
import { useQuery } from "@tanstack/react-query";

import { apiRequest } from "../api/api.queries";
import { webText } from "../labels";

export const SITE_STATUS_KEY = ["customer", "site-status"] as const;
export const SITE_STATUS_REFETCH_MS = 60_000;

export function useSiteStatus() {
  return useQuery({
    queryKey: SITE_STATUS_KEY,
    queryFn: async ({ signal }): Promise<SiteStatusResponse> => siteStatusResponseSchema.parse(await apiRequest(SITE_STATUS_PATH, { signal })),
    refetchInterval: SITE_STATUS_REFETCH_MS,
    staleTime: 0,
  });
}

export interface ZaloTarget {
  /** Where a Zalo button goes; null while chat is down and no fallback is set (the button hides). */
  readonly href: string | null;
  readonly down: boolean;
}

/**
 * Every Zalo button reads this: the assistant's private chat (ZALO_ASSISTANT_URL; the community
 * group link from the label file until the owner sets it), or the fallback contact path while
 * the assistant is down.
 */
export function useZaloTarget(): ZaloTarget {
  const status = useSiteStatus().data;
  if (status?.assistant !== "down") return { href: status?.assistantUrl ?? webText("zalo_url"), down: false };
  return { href: status.fallbackContactUrl, down: true };
}
