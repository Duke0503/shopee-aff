/**
 * Customer merge by admin command (FR-11, AD-23, D42, decision H8, Story 4.19): the internal CLI
 * previews, then applies, the merge of one customer record into a survivor. The preview shows both
 * customers, the survivor, each one's balance from `getBalances` and the resulting balance; apply
 * returns the survivor's balance read again after the merge. Bank accounts appear only as the
 * bank's name and the last four digits.
 */
import { z } from "zod";

const key = z.string().trim().min(1).max(64);
const dong = z.number().int().min(0);

export const customerMergeRequestSchema = z.strictObject({ merged: key, survivor: key });
export type CustomerMergeRequest = z.infer<typeof customerMergeRequestSchema>;

export const mergeBalanceSchema = z.object({ gross: dong, payable: dong, waiting: dong, paid: dong, deductedNext: dong });
export type MergeBalance = z.infer<typeof mergeBalanceSchema>;

export const mergeSideSchema = z.object({
  customerId: z.string(),
  customerCode: z.string().nullable(),
  customerName: z.string().nullable(),
  status: z.enum(["ACTIVE", "DISABLED"]),
  bank: z.object({ bankName: z.string().nullable(), lastFour: z.string() }).nullable(),
  balance: mergeBalanceSchema,
});

export const customerMergePreviewSchema = z.object({
  merged: mergeSideSchema,
  survivor: mergeSideSchema,
  survivorId: z.string(),
  /** The merged record's bank account moves to a survivor that has none. */
  bankMoves: z.boolean(),
  /** What the survivor's balance becomes: both balances read together through the aliases. */
  result: mergeBalanceSchema,
});
export type CustomerMergePreview = z.infer<typeof customerMergePreviewSchema>;

export const customerMergedResponseSchema = z.object({
  mergedId: z.string(),
  survivorId: z.string(),
  bankMoves: z.boolean(),
  /** The survivor's balance from `getBalances` after the merge committed. */
  balance: mergeBalanceSchema,
});
export type CustomerMergedResponse = z.infer<typeof customerMergedResponseSchema>;
