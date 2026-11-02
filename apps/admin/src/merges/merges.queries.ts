/**
 * Customer merges on the desk (FR-11, Stories 4.19 and 6.11): the proposals after a new Zalo
 * account, the dialog's preview (both sides with the plan or the refusal) and the merge itself.
 * All admin only on the server. The preview is read once per pair and never refetched behind the
 * admin's back; after a merge every desk query refreshes (LC-10), as after an erase.
 */
import { customerMergedResponseSchema, customerMergeProposalsSchema, deskMergePreviewSchema, type CustomerMergedResponse, type CustomerMergeProposals, type DeskMergePreview } from "@cashback/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiRequest } from "../api/api.queries";

export const MERGES_KEY = ["admin", "merges"] as const;

export interface MergePair {
  /** The record that becomes an alias. */
  readonly merged: string;
  /** The record that is kept. */
  readonly survivor: string;
}

export function useMergeProposals(enabled: boolean) {
  return useQuery({
    queryKey: [...MERGES_KEY, "proposals"],
    queryFn: async ({ signal }): Promise<CustomerMergeProposals> => customerMergeProposalsSchema.parse(await apiRequest("/api/admin/merges/proposals", { signal })),
    enabled,
  });
}

export function useMergePreview(pair: MergePair | null) {
  return useQuery({
    queryKey: [...MERGES_KEY, "preview", pair?.merged, pair?.survivor],
    queryFn: async ({ signal }): Promise<DeskMergePreview> => deskMergePreviewSchema.parse(await apiRequest("/api/admin/merges/preview", { method: "POST", body: pair, signal })),
    enabled: pair !== null,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    gcTime: 0,
  });
}

export function useApplyMerge() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (pair: MergePair): Promise<CustomerMergedResponse> => customerMergedResponseSchema.parse(await apiRequest("/api/admin/merges", { method: "POST", body: pair })),
    // The preview just applied would now read as refused; it closes with the dialog instead.
    onSuccess: () => client.invalidateQueries({ queryKey: ["admin"], predicate: (query) => query.queryKey[1] !== "session" && !(query.queryKey[1] === MERGES_KEY[1] && query.queryKey[2] === "preview") }),
  });
}
