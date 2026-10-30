/**
 * The admin Orders list row (FR-26, FR-37, Story 4.13): one value per field, as stored. The
 * customer code and name apart; one date per kind (recorded, approved, paid); the approved
 * commission and the cashback are the stored figures, null until the network approves; the
 * product is the link's snapshot (D56), its image https only. `settledBy` is the network payout
 * that paid the operator for the order (D59), null while unpaid.
 */
import { INSTANT_PATTERN } from "@cashback/core";
import { z } from "zod";

import { listResponseSchema } from "./list.schema";

const instant = z.string().regex(INSTANT_PATTERN);
const dong = z.number().int().min(0);

export const ORDER_NETWORKS = ["shopee", "accesstrade"] as const;
export type OrderNetworkName = (typeof ORDER_NETWORKS)[number];

/** The date kinds of the Orders list, each its own column and filter. */
export const ORDER_DATE_FIELDS = ["recordedAt", "approvedAt", "paidAt"] as const;
export type OrderDateField = (typeof ORDER_DATE_FIELDS)[number];

export const adminOrderRowSchema = z.object({
  orderId: z.string(),
  customerCode: z.string().nullable(),
  customerName: z.string().nullable(),
  productName: z.string().nullable(),
  productImageUrl: z.url({ protocol: /^https$/ }).nullable(),
  network: z.enum(ORDER_NETWORKS).nullable(),
  status: z.string(),
  orderValue: dong.nullable(),
  approvedCommission: dong.nullable(),
  cashback: dong.nullable(),
  recordedAt: instant.nullable(),
  approvedAt: instant.nullable(),
  paidAt: instant.nullable(),
  settledBy: z.string().nullable(),
});
export type AdminOrderRow = z.infer<typeof adminOrderRowSchema>;

export const adminOrdersResponseSchema = listResponseSchema(adminOrderRowSchema);
