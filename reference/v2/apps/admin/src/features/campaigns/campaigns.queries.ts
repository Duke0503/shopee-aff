import { useEffect, useState } from "react";

import { createApiClient, type ApiCampaign } from "@mmo/contracts";

/** Data loading lives here, never inside a component (the coding rules). */
const api = createApiClient();

export interface CampaignsState {
  campaigns: ApiCampaign[];
  error: string;
}

export function useCampaigns(): CampaignsState {
  const [campaigns, setCampaigns] = useState<ApiCampaign[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .adminCampaigns()
      .then(setCampaigns)
      .catch((cause: Error) => setError(cause.message));
  }, []);
  return { campaigns, error };
}
