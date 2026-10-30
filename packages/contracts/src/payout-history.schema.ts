/**
 * The payout history (FR-17, FR-34, FR-37, Story 4.12): every payout, voided ones included, on the
 * list contract. One value per field: the customer code and name apart, the amount that left the
 * bank (`amount`, 0 for a netting-only payout) apart from what it still counts as paid
 * (`paidAmount`, 0 once voided), the staff member who recorded it, the void time, and the receipt
 * token of /b/<token>. The summary's `paidAmount` is the sum over the filtered set without voided
 * payouts, and says so on screen.
 */
import { INSTANT_PATTERN } from "@cashback/core";
import { z } from "zod";

import { listResponseSchema } from "./list.schema";

const instant = z.string().regex(INSTANT_PATTERN);
const dong = z.number().int().min(0);

export const payoutHistoryRowSchema = z.object({
  payoutId: z.number().int().min(1),
  customerId: z.string(),
  customerCode: z.string().nullable(),
  customerName: z.string().nullable(),
  amount: dong,
  paidAmount: dong,
  status: z.enum(["RECORDED", "VOIDED"]),
  recordedAt: instant.nullable(),
  recordedBy: z.string().nullable(),
  voidedAt: instant.nullable(),
  receiptToken: z.string().nullable(),
});
export type PayoutHistoryRow = z.infer<typeof payoutHistoryRowSchema>;

export const payoutHistoryResponseSchema = listResponseSchema(payoutHistoryRowSchema);
export type PayoutHistoryResponse = z.infer<typeof payoutHistoryResponseSchema>;
