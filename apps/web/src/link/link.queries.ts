/**
 * The home page's link converter calls (Story 7.6, code.md §10): queue a link, then ask what it
 * has become while the server waits on the bridge (the page only polls, EXPERIENCE.md link
 * converter). Polling stops once the link is made and its product facts are settled, or failed;
 * a made link whose facts are still coming is asked a few more times only, counted in answers.
 */
import { WEB_LINK_PATH, WEB_LINK_POLL_MS, webLinkPath, webLinkQueuedSchema, webLinkResultSchema, type WebLinkQueued, type WebLinkRequest, type WebLinkResult } from "@cashback/contracts";
import { useMutation, useQuery, type Query } from "@tanstack/react-query";

import { apiRequest } from "../api/api.queries";

/** Polls of a made link waiting for its price and rate before the result shows without them. */
export const FACTS_POLLS_MAX = 12;
/** After this long the creating state says the link is slow (and who will be told). */
export const LINK_SLOW_AFTER_MS = 90_000;

export function useQueueLink() {
  return useMutation({
    mutationFn: async (body: WebLinkRequest): Promise<WebLinkQueued> => webLinkQueuedSchema.parse(await apiRequest(WEB_LINK_PATH, { method: "POST", body })),
  });
}

/** How long to wait before asking again, or false to stop. */
export function nextPoll(result: WebLinkResult | undefined, readyPolls: number): number | false {
  if (result === undefined || result.state === "creating") return WEB_LINK_POLL_MS;
  if (result.state === "failed" || result.factsSettled) return false;
  return readyPolls < FACTS_POLLS_MAX ? WEB_LINK_POLL_MS : false;
}

export function useLinkResult(ticket: string | null) {
  return useQuery({
    queryKey: ["link", ticket],
    queryFn: async ({ signal }): Promise<WebLinkResult> => webLinkResultSchema.parse(await apiRequest(webLinkPath(ticket ?? ""), { signal })),
    enabled: ticket !== null,
    refetchInterval: (query: Query<WebLinkResult>) => nextPoll(query.state.data, readyPollsOf(query)),
    refetchOnWindowFocus: false,
    retry: 2,
  });
}

/**
 * Ready answers one query has received: each settled fetch has its own `dataUpdatedAt`, so the
 * count grows once per answer however often the interval is worked out (a re-render asks again).
 */
const readyAnswers = new WeakMap<object, Set<number>>();
export function readyPollsOf(query: Pick<Query<WebLinkResult>, "state">): number {
  const seen = readyAnswers.get(query) ?? new Set<number>();
  readyAnswers.set(query, seen);
  if (query.state.data?.state !== "ready") {
    seen.clear();
    return 0;
  }
  seen.add(query.state.dataUpdatedAt);
  return seen.size;
}
