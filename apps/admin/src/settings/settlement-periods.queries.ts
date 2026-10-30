/**
 * Settlement periods on Settings (FR-13, D54, Story 4.18): the periods with their withheld
 * setting, the server's count of orders a change would reach (read when the confirmation opens),
 * and the mark itself, which sends only the new setting; the server records who made it. After a
 * mark the periods refresh, and so does every desk query (LC-10).
 */
import { settlementPeriodImpactSchema, settlementPeriodSchema, settlementPeriodsResponseSchema, type SettlementPeriod, type SettlementPeriodImpact, type SettlementPeriodsResponse } from "@cashback/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiRequest } from "../api/api.queries";

export const SETTLEMENT_PERIODS_KEY = ["admin", "settlement-periods"] as const;

const periodPath = (network: string, periodMonth: string): string => `/api/admin/settlement-periods/${encodeURIComponent(network)}/${encodeURIComponent(periodMonth)}`;

export function useSettlementPeriods() {
  return useQuery({
    queryKey: SETTLEMENT_PERIODS_KEY,
    queryFn: async ({ signal }): Promise<SettlementPeriodsResponse> => settlementPeriodsResponseSchema.parse(await apiRequest("/api/admin/settlement-periods", { signal })),
  });
}

/** The server's count of orders the period's opposite setting would reach, asked when the confirmation opens. */
export function usePeriodImpact(period: SettlementPeriod | null) {
  const next = period === null ? true : !period.withheld;
  return useQuery({
    queryKey: [...SETTLEMENT_PERIODS_KEY, "impact", period?.network, period?.periodMonth, next],
    queryFn: async ({ signal }): Promise<SettlementPeriodImpact> => settlementPeriodImpactSchema.parse(await apiRequest(`${periodPath(period?.network ?? "", period?.periodMonth ?? "")}/impact?withheld=${String(next)}`, { signal })),
    enabled: period !== null,
    staleTime: 0,
  });
}

export interface PeriodMark {
  readonly network: string;
  readonly periodMonth: string;
  readonly withheld: boolean;
}

export function useMarkPeriod() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ network, periodMonth, withheld }: PeriodMark): Promise<SettlementPeriod> => settlementPeriodSchema.parse(await apiRequest(periodPath(network, periodMonth), { method: "POST", body: { withheld } })),
    onSettled: () => client.invalidateQueries({ queryKey: ["admin"], predicate: (query) => query.queryKey[1] !== "session" }),
  });
}
