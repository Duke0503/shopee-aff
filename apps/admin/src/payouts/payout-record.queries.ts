/**
 * Server calls on a recorded payout (Stories 4.9 and 4.10): the proof image upload, the void
 * preview and the void itself. The proof goes up as the image bytes after the payout is recorded;
 * the server decides what it accepts. The void preview is the server's list of orders and the
 * state each returns to (M-3, D41); the dialog shows it and adds nothing. A void changes the
 * payouts list, the orders, the customer page and the Overview, so every desk query but the
 * session is invalidated (LC-10).
 */
import { payoutProofResponseSchema, payoutVoidPreviewSchema, payoutVoidResponseSchema, PROOF_MAX_BYTES, PROOF_TYPES, type PayoutProofResponse, type PayoutVoidPreview, type PayoutVoidResponse } from "@cashback/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiRequest } from "../api/api.queries";

/** Every desk query sits under this key, so one invalidation refreshes all of them. */
export const DESK_KEY = ["admin"] as const;
export const voidPreviewKey = (payoutId: number) => ["admin", "payout-void", payoutId] as const;

/** The staff-only proof image URL; the browser sends the Access and staff cookies with it. */
export const proofUrl = (payoutId: number): string => `/api/admin/payouts/${payoutId}/proof`;

export const isProofType = (type: string): boolean => (PROOF_TYPES as readonly string[]).includes(type);

/** Why the picker refuses a file before sending it, in the server's own words; null when it may go. */
export const proofFileRefusal = (file: File): "error.proof.not_an_image" | "error.proof.too_large" | null =>
  !isProofType(file.type) ? "error.proof.not_an_image" : file.size > PROOF_MAX_BYTES ? "error.proof.too_large" : null;

export function useUploadProof() {
  return useMutation({
    mutationFn: async ({ payoutId, file }: { readonly payoutId: number; readonly file: Blob }): Promise<PayoutProofResponse> => payoutProofResponseSchema.parse(await apiRequest(proofUrl(payoutId), { method: "POST", file })),
  });
}

export function useVoidPreview(payoutId: number, enabled: boolean) {
  return useQuery({
    queryKey: voidPreviewKey(payoutId),
    queryFn: async ({ signal }): Promise<PayoutVoidPreview> => payoutVoidPreviewSchema.parse(await apiRequest(`/api/admin/payouts/${payoutId}/void`, { signal })),
    enabled,
    staleTime: 0,
  });
}

export function useVoidPayout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ payoutId, reason }: { readonly payoutId: number; readonly reason: string }): Promise<PayoutVoidResponse> =>
      payoutVoidResponseSchema.parse(await apiRequest(`/api/admin/payouts/${payoutId}/void`, { method: "POST", body: { reason } })),
    onSuccess: () => client.invalidateQueries({ queryKey: DESK_KEY, predicate: (query) => query.queryKey[1] !== "session" }),
  });
}
