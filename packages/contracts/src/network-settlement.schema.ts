/**
 * Network payout batches matched to exact orders (FR-19, D27, D59, Story 4.21).
 *
 * The record request is what the network said about one payout batch, in whole dong (a network
 * adapter converts its own units with `fromNetworkUnits` first; Shopee's are x100,000): its id,
 * status, what reached the operator (`amount`, Shopee totalPaymentAmount), the batch's gross
 * commission (`eligibleAmount`, eligibleTotalAmount), its creation and arrival times and, when the
 * network lists them, the order ids it pays. It arrives on the internal listener only (the browser
 * bridge or an export), never from the desk.
 *
 * The desk reads the network payouts tab of Payouts as a list on the list contract, and one
 * batch's detail: gross, fee, tax, received, the gross of the operator's matched orders and the
 * unattributed rest, and each order with its product snapshot, all from the server.
 */
import { INSTANT_PATTERN } from "@cashback/core";
import { z } from "zod";

import { listResponseSchema } from "./list.schema";

const instant = z.string().regex(INSTANT_PATTERN);
const dong = z.number().int().min(0);

export const SETTLEMENT_NETWORKS = ["shopee", "accesstrade"] as const;
export const NETWORK_SETTLEMENT_STATUSES = ["PROCESSING", "PAID", "FAILED"] as const;
/** What the match did: PENDING (not paid yet), MATCHED, MISMATCH (nothing settled), HISTORIC (before the cutover: totals only, never matched). */
export const SETTLEMENT_MATCHES = ["PENDING", "MATCHED", "MISMATCH", "HISTORIC"] as const;
export type SettlementMatchKind = (typeof SETTLEMENT_MATCHES)[number];
export const SETTLEMENT_ORDER_OUTCOMES = ["SETTLED", "CANDIDATE", "CONFLICT", "NOT_APPROVED", "UNKNOWN"] as const;
export type SettlementOrderOutcome = (typeof SETTLEMENT_ORDER_OUTCOMES)[number];

/** The most order ids one batch may list; a longer list is refused rather than cut. */
export const NETWORK_PAYOUT_MAX_ORDERS = 5000;

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const networkPayoutRecordSchema = z.strictObject({
  network: z.enum(SETTLEMENT_NETWORKS),
  networkPayoutId: id,
  status: z.enum(NETWORK_SETTLEMENT_STATUSES),
  amount: dong,
  eligibleAmount: dong.nullable().optional(),
  createdAt: instant.nullable().optional(),
  paidAt: instant.nullable().optional(),
  /** The orders the network says it pays; absent or null when it did not list them. */
  orderIds: z.array(id).max(NETWORK_PAYOUT_MAX_ORDERS).nullable().optional(),
});
export type NetworkPayoutRecord = z.infer<typeof networkPayoutRecordSchema>;

export const networkPayoutRecordResponseSchema = z.object({
  settlementId: z.number().int().min(1),
  match: z.enum(SETTLEMENT_MATCHES),
  withheld: z.boolean().nullable(),
  settled: z.number().int().min(0),
  conflicts: z.number().int().min(0),
  notApproved: z.number().int().min(0),
  unknown: z.number().int().min(0),
  matchedGross: dong.nullable(),
  unattributed: z.number().int().nullable(),
  /** Review cases opened or refreshed by this record. */
  caseIds: z.array(z.number().int().min(1)),
  /** The record said other facts than the stored ones: audited, a case opened, the stored facts kept. */
  factsChanged: z.boolean(),
  replay: z.boolean(),
});
export type NetworkPayoutRecordResponse = z.infer<typeof networkPayoutRecordResponseSchema>;

export const networkSettlementRowSchema = z.object({
  settlementId: z.number().int().min(1),
  network: z.enum(SETTLEMENT_NETWORKS),
  networkPayoutId: z.string(),
  status: z.enum(NETWORK_SETTLEMENT_STATUSES),
  match: z.enum(SETTLEMENT_MATCHES),
  /** What reached the operator. */
  amount: dong,
  /** The batch's gross commission. */
  eligibleAmount: dong.nullable(),
  withheld: z.boolean().nullable(),
  fee: dong.nullable(),
  tax: dong.nullable(),
  /** The gross of the operator's orders matched (or proposed for a mismatch). */
  matchedGross: dong.nullable(),
  /** Gross paid for orders attributed to no customer; negative when the orders exceed the batch. */
  unattributed: z.number().int().nullable(),
  orderCount: z.number().int().min(0),
  createdAt: instant.nullable(),
  paidAt: instant.nullable(),
});
export type NetworkSettlementRow = z.infer<typeof networkSettlementRowSchema>;

export const networkSettlementListSchema = listResponseSchema(networkSettlementRowSchema);
export type NetworkSettlementList = z.infer<typeof networkSettlementListSchema>;

export const networkSettlementOrderSchema = z.object({
  orderId: z.string(),
  outcome: z.enum(SETTLEMENT_ORDER_OUTCOMES),
  /** The order's gross (approved commission, the live estimate for an imported order); null when unknown. */
  gross: dong.nullable(),
  /** What the network pays for it under the batch's withholding; null when either is unknown. */
  net: dong.nullable(),
  customerCode: z.string().nullable(),
  customerName: z.string().nullable(),
  productName: z.string().nullable(),
  productImageUrl: z.url({ protocol: /^https$/ }).nullable(),
  status: z.string().nullable(),
  /** The batch that settled the order now (for a conflict: the other batch). */
  settledBy: z.string().nullable(),
});
export type NetworkSettlementOrder = z.infer<typeof networkSettlementOrderSchema>;

export const networkSettlementDetailSchema = networkSettlementRowSchema.extend({
  listed: z.boolean(),
  /** When the previous batch was created: the start of this batch's window; null for the first. */
  windowFrom: instant.nullable(),
  orders: z.array(networkSettlementOrderSchema),
  openCaseIds: z.array(z.number().int().min(1)),
});
export type NetworkSettlementDetail = z.infer<typeof networkSettlementDetailSchema>;

export const networkSettlementParamsSchema = z.strictObject({ settlementId: z.string().regex(/^[1-9]\d{0,15}$/) });
