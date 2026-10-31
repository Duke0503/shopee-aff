/**
 * The Overview (FR-25, FR-27, FR-38, AD-5, AD-27, Story 4.17, docs/operations/dashboard-spec.md):
 * every figure of the landing screen, computed on the server in one query layer; the desk only
 * formats. Money is whole dong; a ratio is integer basis points (1 bps = 0.01%). A figure with no
 * data is null (the grey dash), never 0. Each period figure carries the previous period's value.
 *
 * Time bases (Vietnam days): the business result by approval day, cash by the day money moved,
 * orders by the day they were recorded; the money position and the to-dos are now.
 */
import { INSTANT_PATTERN, MAX_PERIOD_DAYS, OVERVIEW_PERIODS } from "@cashback/core";
import { z } from "zod";

const instant = z.string().regex(INSTANT_PATTERN);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const int = z.number().int();
const count = int.min(0);
const network = z.enum(["shopee", "accesstrade"]);

export { OVERVIEW_PERIODS, MAX_PERIOD_DAYS };

export const overviewQuerySchema = z
  .object({ period: z.enum(OVERVIEW_PERIODS).default("thisMonth"), from: day.optional(), to: day.optional() })
  .refine((q) => q.period !== "custom" || (q.from !== undefined && q.to !== undefined));
export type OverviewQuery = z.infer<typeof overviewQuerySchema>;

/** A period figure, the previous period's and the signed change between them; null where there is nothing to measure. */
export const figureSchema = z.object({ value: int.nullable(), previous: int.nullable(), change: int.nullable() });
export type Figure = z.infer<typeof figureSchema>;

/** A ratio in basis points; `enoughData` false below 100 approved orders (FR-27, the "not enough data" tag). */
export const ratioSchema = z.object({ bps: int.nullable(), previousBps: int.nullable(), changeBps: int.nullable(), enoughData: z.boolean() });
export type Ratio = z.infer<typeof ratioSchema>;

const periodSchema = z.object({
  preset: z.enum(OVERVIEW_PERIODS),
  from: day,
  to: day,
  previousFrom: day,
  previousTo: day,
});

const todoSchema = z.object({
  /** The Payouts tab "payable": customers with a payable balance above 0, and the total. */
  payable: z.object({ customers: count, amount: count }),
  openReviewCases: count,
  failedLinksToday: count,
  /** Customers owed money who have no usable bank account (none, or a website change not confirmed). */
  owedWithoutBank: z.object({ customers: count, amount: count }),
});

const businessSchema = z.object({
  commission: figureSchema,
  approvedOrders: figureSchema,
  byNetwork: z.array(z.object({ network, commission: count, orders: count })),
  fee: figureSchema,
  tax: figureSchema,
  /** The settlement months whose withheld tax is in the figure. */
  withheldPeriods: z.array(z.string()),
  cashback: figureSchema,
  cashbackPaid: count,
  cashbackOwed: count,
  eventBonus: figureSchema,
  byCampaign: z.array(z.object({ campaignId: z.string(), name: z.string(), bonus: count })),
  clawbackNetted: figureSchema,
  /** Profit on the approval basis: orders this system approved in the period. */
  profit: figureSchema,
  /**
   * Owner decision (2026-10-31): orders imported at cutover carry no approval data, so their part is
   * read on the cash basis: what the networks paid in the period in batches imported at cutover,
   * minus the imported payouts recorded in the period. Null when the period holds none of that.
   */
  cashBasis: z.object({ received: count, paidOut: count, profit: int, previousProfit: int.nullable() }).nullable(),
  /** The profit card's top figure: the approval-basis profit plus the cash-basis part, each where present. */
  totalProfit: figureSchema,
  margin: ratioSchema,
  /**
   * Where the money of the period went, each part's share of the whole (commission plus clawback
   * netted): fee and tax, cashback, event bonus, profit. Null when there is nothing or a loss.
   */
  split: z.object({ feeAndTax: count, feeAndTaxBps: count, cashbackBps: count, eventBonusBps: count, profitBps: count }).nullable(),
  /** Approved orders whose fee and tax were not stored (imported): their split is counted as 0. */
  withoutSplit: count,
  /** Orders imported at cutover, paid in the period, with no approval facts: not in this block. */
  importedWithoutApproval: count,
});

const cashSchema = z.object({
  networkBatches: count,
  networkGross: figureSchema,
  networkFee: count,
  networkTax: count,
  received: figureSchema,
  paidOut: figureSchema,
  payouts: count,
  difference: figureSchema,
});

const moneySchema = z.object({
  networksOwe: count,
  weOweCustomers: count,
  customersOweUs: count,
  awaiting: z.object({ orders: count, commission: count, cashback: count }),
  cash: cashSchema,
  /** Owner decision (2026-10-31): batches the networks created and have not paid yet (shown as its own line under what the networks owe). */
  processing: z.object({ batches: count, gross: count, received: count }),
  /** Owed to customers is more than received minus paid out over the last 60 days. */
  advanceWarning: z.boolean(),
  last60Days: z.object({ received: count, paidOut: count }),
});

const weekSchema = z.object({ weekStart: day, profit: int, commission: count, cashback: count });
const trendSchema = z.object({
  weeks: z.array(weekSchema),
  totals: z.object({ profit: figureSchema, commission: figureSchema, cashback: figureSchema }),
});

const networkOrdersSchema = z.object({
  network: z.enum(["shopee", "accesstrade", "all"]),
  linksDelivered: count,
  recorded: count,
  ordersPerLink: ratioSchema,
  approved: count,
  cancelled: count,
  awaiting: count,
  cancelRate: ratioSchema,
  averageCommission: int.nullable(),
  effectiveRate: ratioSchema,
});

const eventSchema = z.object({
  campaignId: z.string(),
  name: z.string(),
  startsAt: instant,
  endsAt: instant,
  slotsUsed: count,
  slots: count,
  bonus: count,
  commission: count,
  operatorShare: int,
  result: int,
});

const customersSchema = z.object({
  withOrder: figureSchema,
  newCustomers: figureSchema,
  repeatShare: ratioSchema,
  /** One customer holds more than 30% of the period's commission. */
  concentration: z.object({ customerCode: z.string().nullable(), shareBps: count }).nullable(),
});

export const HEALTH_COMPONENTS = ["bridge", "assistant", "reconciliation", "backup"] as const;
export const HEALTH_STATES = ["up", "down", "unknown"] as const;
const healthSchema = z.object({ component: z.enum(HEALTH_COMPONENTS), state: z.enum(HEALTH_STATES), at: instant.nullable() });

export const overviewSchema = z.object({
  asOf: instant,
  period: periodSchema,
  todo: todoSchema,
  business: businessSchema,
  money: moneySchema,
  trend: trendSchema,
  orders: z.object({ networks: z.array(networkOrdersSchema), aged: count }),
  events: z.array(eventSchema),
  customers: customersSchema,
  health: z.array(healthSchema),
});
export type Overview = z.infer<typeof overviewSchema>;
export type OverviewEvent = z.infer<typeof eventSchema>;
export type OverviewNetworkOrders = z.infer<typeof networkOrdersSchema>;
export type OverviewHealth = z.infer<typeof healthSchema>;
export type OverviewWeek = z.infer<typeof weekSchema>;
