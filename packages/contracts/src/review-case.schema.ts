/**
 * Review case preview, apply and dismiss on the admin desk (FR-14, Stories 3.9 and 4.2):
 * `POST /api/admin/review-cases/:caseId/{preview,apply,dismiss}`. No body carries an amount or
 * an order; apply may only name one of the case's own candidates.
 */
import { z } from "zod";

export const reviewApplyRequestSchema = z.strictObject({
  reason: z.string().max(500),
  customerId: z.string().regex(/^[A-Za-z0-9]{1,64}$/).optional(),
  outcome: z.enum(["restore", "reject"]).optional(),
});
export type ReviewApplyRequest = z.infer<typeof reviewApplyRequestSchema>;

export const reviewDismissRequestSchema = z.strictObject({ reason: z.string().max(500) });
export type ReviewDismissRequest = z.infer<typeof reviewDismissRequestSchema>;

export const reviewCaseIdSchema = z.strictObject({ caseId: z.coerce.number().int().min(1) });

export const reviewPreviewResponseSchema = z.object({
  caseId: z.number().int(),
  orderId: z.string(),
  customerId: z.string().nullable(),
  /** The code of that customer, for "the order will belong to DP00031". */
  customerCode: z.string().nullable(),
  from: z.string().nullable(),
  to: z.string(),
  cashback: z.number().int().nullable(),
});
export type ReviewPreviewResponse = z.infer<typeof reviewPreviewResponseSchema>;

export const reviewOutcomeResponseSchema = z.object({
  caseId: z.number().int(),
  orderId: z.string().nullable(),
  resolution: z.enum(["APPLIED", "DISMISSED"]),
});
export type ReviewOutcomeResponse = z.infer<typeof reviewOutcomeResponseSchema>;
