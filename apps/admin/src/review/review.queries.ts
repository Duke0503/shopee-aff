/**
 * The review queue's server calls (FR-14, UJ-6, Story 4.15): the list on the list contract (the
 * tab is `filter[status]`, open when absent, and both tabs' totals come with it), one case's
 * panel, and the Story 3.9 preview, apply and dismiss. No body carries an amount, and apply names
 * at most one of the case's own candidates. Apply and dismiss invalidate every query that shows
 * what they change (LC-10): the queue and its counts, the orders, Payouts, the customers and their
 * pages, and the Overview figures.
 */
import {
  listSearch,
  REVIEW_CASE_REASONS,
  REVIEW_NETWORKS,
  reviewCaseDetailSchema,
  reviewCaseListSchema,
  reviewOutcomeResponseSchema,
  reviewPreviewResponseSchema,
  type ListSearchState,
  type ReviewApplyRequest,
  type ReviewCaseDetail,
  type ReviewCaseList,
  type ReviewOutcomeResponse,
  type ReviewPreviewResponse,
} from "@cashback/contracts";
import { useListQuery } from "@cashback/ui";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { apiRequest } from "../api/api.queries";
import { CUSTOMERS_KEY } from "../customers/customers.queries";
import { ORDERS_KEY } from "../orders/orders.queries";
import { PAYOUTS_KEY } from "../payouts/payouts.queries";

export const REVIEW_KEY = ["admin", "review-cases"] as const;
/** The Overview figures (its "cases to review" tile); the page that reads them is Story 4.5's. */
export const OVERVIEW_KEY = ["admin", "overview"] as const;

export const REVIEW_STATUSES = ["OPEN", "RESOLVED"] as const;
export type ReviewTab = (typeof REVIEW_STATUSES)[number];

export const REVIEW_SEARCH = listSearch({
  sortable: ["caseId", "network", "orderId", "reason", "openedAt", "resolvedAt"],
  filters: [
    { field: "status", values: REVIEW_STATUSES },
    { field: "reason", values: REVIEW_CASE_REASONS },
    { field: "network", values: REVIEW_NETWORKS },
    { field: "openedAt" },
  ],
  defaultSort: { field: "openedAt", direction: "asc" },
});

/** The tab a URL state shows: open cases unless it names the resolved ones. */
export const tabOfState = (state: ListSearchState): ReviewTab =>
  state.filters["status"]?.[0] === "RESOLVED" ? "RESOLVED" : "OPEN";

export async function fetchReviewCases(
  query: string,
  signal: AbortSignal,
): Promise<ReviewCaseList> {
  return reviewCaseListSchema.parse(
    await apiRequest(`/api/admin/review-cases?${query}`, { signal }),
  );
}

/** One tab of the queue; `paused` while a case's panel is open (LC-11). */
export function useReviewCases(state: ListSearchState, tab: ReviewTab, paused: boolean) {
  const withTab: ListSearchState = { ...state, filters: { ...state.filters, status: [tab] } };
  return useListQuery({
    key: REVIEW_KEY,
    search: REVIEW_SEARCH,
    state: withTab,
    fetchList: fetchReviewCases,
    paused,
  });
}

export function useReviewCase(caseId: number | null) {
  return useQuery({
    queryKey: [...REVIEW_KEY, "case", caseId],
    queryFn: async ({ signal }): Promise<ReviewCaseDetail> =>
      reviewCaseDetailSchema.parse(
        await apiRequest(`/api/admin/review-cases/${caseId}`, { signal }),
      ),
    enabled: caseId !== null,
    refetchOnWindowFocus: false,
  });
}

export interface ReviewApply extends ReviewApplyRequest {
  readonly caseId: number;
}

const casePath = (caseId: number, step: "preview" | "apply" | "dismiss"): string =>
  `/api/admin/review-cases/${caseId}/${step}`;
const bodyOf = ({ caseId: _caseId, ...body }: ReviewApply): ReviewApplyRequest => body;

export function usePreviewReview() {
  return useMutation({
    mutationFn: async (input: ReviewApply): Promise<ReviewPreviewResponse> =>
      reviewPreviewResponseSchema.parse(
        await apiRequest(casePath(input.caseId, "preview"), {
          method: "POST",
          body: bodyOf(input),
        }),
      ),
  });
}

/** Every query a resolved case can change (LC-10). */
export function refreshAfterReview(client: QueryClient): Promise<unknown> {
  return Promise.all(
    [REVIEW_KEY, ORDERS_KEY, PAYOUTS_KEY, CUSTOMERS_KEY, OVERVIEW_KEY].map((queryKey) =>
      client.invalidateQueries({ queryKey }),
    ),
  );
}

export function useApplyReview() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: ReviewApply): Promise<ReviewOutcomeResponse> =>
      reviewOutcomeResponseSchema.parse(
        await apiRequest(casePath(input.caseId, "apply"), { method: "POST", body: bodyOf(input) }),
      ),
    onSuccess: () => refreshAfterReview(client),
  });
}

export function useDismissReview() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      caseId,
      reason,
    }: {
      readonly caseId: number;
      readonly reason: string;
    }): Promise<ReviewOutcomeResponse> =>
      reviewOutcomeResponseSchema.parse(
        await apiRequest(casePath(caseId, "dismiss"), { method: "POST", body: { reason } }),
      ),
    onSuccess: () => refreshAfterReview(client),
  });
}
