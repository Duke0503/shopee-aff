/**
 * The Overview's one read (FR-25, Story 4.17): every figure comes from `GET /api/admin/overview`
 * for the period in the URL; the desk only formats. While a new period loads, the previous answer
 * stays on screen dimmed and keeps its own period label, so old figures never sit under a new
 * period's name (regression "all-time numbers under the new period label"). Every mutation of
 * the desk invalidates the `admin` keys, this one included (LC-10).
 */
import { OVERVIEW_PERIODS, overviewSchema, type Overview } from "@cashback/contracts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { apiRequest } from "../api/api.queries";

export type OverviewPreset = (typeof OVERVIEW_PERIODS)[number];

export interface OverviewSearch {
  readonly period?: OverviewPreset;
  readonly from?: string;
  readonly to?: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The route's search: a known preset (the default, "this month", is left out of the URL) and, for custom, both days. */
export function overviewSearch(raw: Record<string, unknown>): OverviewSearch {
  const period = OVERVIEW_PERIODS.find((p) => p === raw["period"]);
  const day = (key: string): string | undefined => (typeof raw[key] === "string" && DAY.test(raw[key]) ? raw[key] : undefined);
  if (period === undefined || period === "thisMonth") return {};
  if (period !== "custom") return { period };
  const from = day("from");
  const to = day("to");
  return from === undefined || to === undefined ? {} : { period, from, to };
}

export const OVERVIEW_KEY = ["admin", "overview"] as const;

export function overviewPath(search: OverviewSearch): string {
  const params = new URLSearchParams({ period: search.period ?? "thisMonth", ...(search.from === undefined ? {} : { from: search.from }), ...(search.to === undefined ? {} : { to: search.to }) });
  return `/api/admin/overview?${params.toString()}`;
}

export function useOverview(search: OverviewSearch) {
  return useQuery({
    queryKey: [...OVERVIEW_KEY, search.period ?? "thisMonth", search.from ?? "", search.to ?? ""],
    queryFn: async ({ signal }): Promise<Overview> => overviewSchema.parse(await apiRequest(overviewPath(search), { signal })),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
}
