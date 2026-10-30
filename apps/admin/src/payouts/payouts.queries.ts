/**
 * The Payouts screen's server calls (FR-16, FR-17, Stories 4.6, 4.7 and 4.8): the list on the list
 * contract (the tab is `filter[queue]`, and both tabs' totals come with it), and the payout claim. Opening a
 * payout is a POST with an empty body: the browser sends no amount and no order list (INV-4); the
 * preview it gets back is kept as the mutation's result and never refetched while the panel is
 * open (LC-11). Closing the panel releases the claim and refreshes the list (LC-10); a claim whose
 * answer arrives after the panel was closed is released at once, so no OPEN claim is left behind.
 * Confirm sends only the snapshot hash of the preview shown; once it is recorded, the payouts and
 * orders lists refresh (LC-10).
 */
import {
  listSearch,
  PAYOUT_QUEUES,
  payoutAccountResponseSchema,
  payoutClaimResponseSchema,
  payoutConfirmResponseSchema,
  payoutListResponseSchema,
  payoutReleaseResponseSchema,
  type ListSearchState,
  type PayoutClaimResponse,
  type PayoutConfirmResponse,
  type PayoutListResponse,
  type PayoutQueue,
} from "@cashback/contracts";
import { useListQuery } from "@cashback/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiRequest } from "../api/api.queries";
import { ORDERS_KEY } from "../orders/orders.queries";

export const PAYOUTS_KEY = ["admin", "payouts"] as const;

export const PAYOUTS_SEARCH = listSearch({
  sortable: ["customerCode", "customerName", "bankName", "orderCount", "payable"],
  filters: [{ field: "queue", values: PAYOUT_QUEUES }],
  defaultSort: { field: "payable", direction: "desc" },
});

/** The tab a URL state shows: "payable now" unless it names the other one. */
export const queueOfState = (state: ListSearchState): PayoutQueue => (state.filters["queue"]?.[0] === "ACTION" ? "ACTION" : "PAYABLE");

export async function fetchPayouts(query: string, signal: AbortSignal): Promise<PayoutListResponse> {
  return payoutListResponseSchema.parse(await apiRequest(`/api/admin/payouts?${query}`, { signal }));
}

/** The list of one tab; `paused` while a payout panel is open (LC-11). */
export function usePayoutsList(state: ListSearchState, queue: PayoutQueue, paused: boolean) {
  const withQueue: ListSearchState = { ...state, filters: { ...state.filters, queue: [queue] } };
  return useListQuery({ key: PAYOUTS_KEY, search: PAYOUTS_SEARCH, state: withQueue, fetchList: fetchPayouts, paused });
}

async function releaseClaim(claimId: string) {
  return payoutReleaseResponseSchema.parse(await apiRequest(`/api/admin/payout-claims/${encodeURIComponent(claimId)}/release`, { method: "POST", body: {} }));
}

/**
 * Opens a payout. `stillOpen` says whether the panel still shows this customer when the answer
 * arrives; if it was closed meanwhile, the claim just made is released before the answer is used.
 */
export function useOpenPayout(stillOpen: (customerId: string) => boolean) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (customerId: string): Promise<PayoutClaimResponse> => {
      const answer = payoutClaimResponseSchema.parse(await apiRequest(`/api/admin/payouts/${encodeURIComponent(customerId)}/claim`, { method: "POST", body: {} }));
      if (answer.outcome === "claimed" && !stillOpen(customerId)) {
        await releaseClaim(answer.claimId).finally(() => client.invalidateQueries({ queryKey: PAYOUTS_KEY }));
      }
      return answer;
    },
  });
}

export function useReleasePayout() {
  const client = useQueryClient();
  return useMutation({ mutationFn: releaseClaim, onSettled: () => client.invalidateQueries({ queryKey: PAYOUTS_KEY }) });
}

/** The full account number for the copy button; the server records each reveal in the audit trail. */
export async function revealAccountNumber(claimId: string): Promise<string> {
  return payoutAccountResponseSchema.parse(await apiRequest(`/api/admin/payout-claims/${encodeURIComponent(claimId)}/account`, { method: "POST", body: {} })).accountNumber;
}

export interface ConfirmRequest {
  readonly claimId: string;
  readonly snapshotHash: string;
}

/** Records the transfer of the claim shown; the body is the snapshot hash and nothing else (INV-4). */
export function useConfirmPayout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ claimId, snapshotHash }: ConfirmRequest): Promise<PayoutConfirmResponse> =>
      payoutConfirmResponseSchema.parse(await apiRequest(`/api/admin/payout-claims/${encodeURIComponent(claimId)}/confirm`, { method: "POST", body: { snapshotHash } })),
    onSuccess: () => Promise.all([client.invalidateQueries({ queryKey: PAYOUTS_KEY }), client.invalidateQueries({ queryKey: ORDERS_KEY })]),
  });
}
