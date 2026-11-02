/** The guide's money figures from the server (Story 7.7 AC1, code.md §10): the page computes nothing. */
import { GUIDE_PATH, guideFiguresSchema, type GuideFigures } from "@cashback/contracts";
import { useQuery } from "@tanstack/react-query";

import { apiRequest } from "../api/api.queries";

export function useGuideFigures() {
  return useQuery({
    queryKey: ["guide", "figures"],
    queryFn: async ({ signal }): Promise<GuideFigures> => guideFiguresSchema.parse(await apiRequest(GUIDE_PATH, { signal })),
    staleTime: 60 * 60_000,
  });
}
