/**
 * Settlement periods on the Settings screen (FR-13, D54, D59, Story 4.18). A period is a network
 * and the Vietnam month of an approval. A Shopee approval takes the withholding of the network's
 * latest payout batch, read from what it paid (`origin` NETWORK, `basedOn` the batch); the owner's
 * mark on a period overrides it (STAFF); without either it is withheld (DEFAULT, or CUTOVER for a
 * month the import added). An AccessTrade period is always withheld and is not editable. A change
 * affects only approvals after it: the impact answer is the server's count of orders it would
 * reach, and cashback already stored is never recomputed.
 */
import { z } from "zod";

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const PERIOD_NETWORKS = ["shopee", "accesstrade"] as const;
/** Where a period's setting comes from: the default (no row), the cutover import, or a staff mark. */
export const PERIOD_ORIGINS = ["DEFAULT", "CUTOVER", "STAFF", "NETWORK"] as const;

export const settlementPeriodSchema = z.object({
  network: z.enum(PERIOD_NETWORKS),
  periodMonth: month,
  withheld: z.boolean(),
  /** False for a network that always withholds. */
  editable: z.boolean(),
  origin: z.enum(PERIOD_ORIGINS),
  /** The network payout batch the setting is read from, for origin NETWORK. */
  basedOn: z.string().nullable(),
});
export type SettlementPeriod = z.infer<typeof settlementPeriodSchema>;

export const settlementPeriodsResponseSchema = z.object({
  /** The current Vietnam month: the period new approvals fall in. */
  currentMonth: month,
  periods: z.array(settlementPeriodSchema),
});
export type SettlementPeriodsResponse = z.infer<typeof settlementPeriodsResponseSchema>;

export const settlementPeriodParamsSchema = z.strictObject({ network: z.enum(PERIOD_NETWORKS), periodMonth: month });

/** The setting whose impact is asked for. */
export const settlementPeriodImpactQuerySchema = z.strictObject({ withheld: z.enum(["true", "false"]) });

export const settlementPeriodImpactSchema = z.object({
  network: z.enum(PERIOD_NETWORKS),
  periodMonth: month,
  withheld: z.boolean(),
  /** Orders still waiting for approval that would take the new setting if approved in this period. */
  affected: z.number().int().min(0),
});
export type SettlementPeriodImpact = z.infer<typeof settlementPeriodImpactSchema>;

export const settlementPeriodMarkSchema = z.strictObject({ withheld: z.boolean() });
