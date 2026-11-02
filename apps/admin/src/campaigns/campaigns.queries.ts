/**
 * The campaign screen's server calls (FR-23, Story 4.20, admin only): the campaigns with their
 * awards and the event result, the create command's preview while the form is filled, and create.
 * The preview asks again only when the form has stopped changing for a moment; create refreshes
 * the list and the Overview, whose events block reads the same campaigns.
 */
import { deskCampaignPreviewSchema, deskCampaignsSchema, type CampaignInputBody, type CampaignPreviewResponse, type DeskCampaigns } from "@cashback/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { apiRequest } from "../api/api.queries";
import { OVERVIEW_KEY } from "../review/review.queries";

export const CAMPAIGNS_KEY = ["admin", "campaigns"] as const;
export const PREVIEW_DELAY_MS = 400;

export function useCampaigns() {
  return useQuery({
    queryKey: [...CAMPAIGNS_KEY, "list"],
    queryFn: async ({ signal }): Promise<DeskCampaigns> => deskCampaignsSchema.parse(await apiRequest("/api/admin/campaigns", { signal })),
  });
}

/** The value once it has stayed the same for `ms`. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** The command's preview of a filled form (null while a field is missing); writes nothing. */
export function useCampaignPreview(input: CampaignInputBody | null) {
  const key = input === null ? null : JSON.stringify(input);
  const settled = useSettled(key, PREVIEW_DELAY_MS);
  const query = useQuery({
    queryKey: [...CAMPAIGNS_KEY, "preview", settled],
    queryFn: async ({ signal }): Promise<CampaignPreviewResponse> =>
      deskCampaignPreviewSchema.parse(await apiRequest("/api/admin/campaigns/preview", { method: "POST", body: { campaign: JSON.parse(settled ?? "null") as unknown }, signal })),
    enabled: settled !== null && settled === key,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    retry: false,
  });
  /** True when the answer is for the form as it is now, not for an earlier state of it. */
  const current = key !== null && settled === key && !query.isFetching;
  return { query, current };
}

export function useCreateCampaign() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (campaign: CampaignInputBody): Promise<CampaignPreviewResponse> => deskCampaignPreviewSchema.parse(await apiRequest("/api/admin/campaigns", { method: "POST", body: { campaign } })),
    onSuccess: () => Promise.all([[...CAMPAIGNS_KEY, "list"], OVERVIEW_KEY].map((queryKey) => client.invalidateQueries({ queryKey }))),
  });
}
