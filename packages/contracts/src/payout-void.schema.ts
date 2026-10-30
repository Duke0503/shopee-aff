/**
 * Payout void and proof image contracts (FR-18, FR-34, D41, D49, Stories 4.9 and 4.10).
 *
 * Void takes the payout id in the path and a reason in the body, nothing else: the orders it
 * returns and their states are the server's (M-3). The reason is optional in the shape so a
 * missing or blank one is answered `reason_required` by the command, not a bare invalid request.
 * The dialog first reads the preview: each covered order with the state it returns to.
 *
 * A proof upload is the image bytes themselves (`image/jpeg` or `image/png` body); its answer is
 * what was stored, never a URL anyone could pass around.
 */
import { INSTANT_PATTERN, storedValues, type OrderStatus } from "@cashback/core";
import { z } from "zod";

const instant = z.string().regex(INSTANT_PATTERN);
const dong = z.number().int().min(0);

/** An order status as the registry in packages/core defines it. */
const orderStatus = z.custom<OrderStatus>((value) => typeof value === "string" && (storedValues("order") as readonly string[]).includes(value));

export const payoutIdParamsSchema = z.strictObject({ payoutId: z.string().regex(/^[1-9][0-9]{0,14}$/) });

export const payoutVoidRequestSchema = z.strictObject({ reason: z.string().max(500).optional() });
export type PayoutVoidRequest = z.infer<typeof payoutVoidRequestSchema>;

export const payoutVoidPreviewSchema = z.object({
  payoutId: z.number().int().min(1),
  customerId: z.string(),
  customerCode: z.string().nullable(),
  amount: dong,
  status: z.enum(["RECORDED", "VOIDED"]),
  recordedAt: instant.nullable(),
  voidedAt: instant.nullable(),
  orders: z.array(z.object({ orderId: z.string(), cashback: dong, to: orderStatus })),
  awards: z.array(z.object({ awardId: z.number().int().min(1), orderId: z.string(), amount: dong, to: z.enum(["CONFIRMED", "VOID"]) })),
  nettingReversed: dong,
  clawbacksClosed: dong,
  /** What later payouts already netted from clawbacks this void closes: credited back to the customer. */
  refunded: dong,
  /** The customer was told about the payout, so the void sends one correction message. */
  told: z.boolean(),
});
export type PayoutVoidPreview = z.infer<typeof payoutVoidPreviewSchema>;

export const payoutVoidResponseSchema = z.object({
  payoutId: z.number().int().min(1),
  customerId: z.string(),
  amount: dong,
  /** Null only for a voided row that never recorded its time. */
  voidedAt: instant.nullable(),
  orders: z.array(z.object({ orderId: z.string(), to: orderStatus })),
  offsets: z.number().int().min(0),
  corrected: z.boolean(),
  /** True when the payout was already voided and nothing new was written. */
  replay: z.boolean(),
});
export type PayoutVoidResponse = z.infer<typeof payoutVoidResponseSchema>;

/** The only proof image types, everywhere: the upload route's body parser, the stored row and the picker. */
export const PROOF_TYPES = ["image/jpeg", "image/png"] as const;
export type ProofType = (typeof PROOF_TYPES)[number];
/** The largest proof upload, in bytes; the route's body limit and the picker's own check. */
export const PROOF_MAX_BYTES = 8 * 1024 * 1024;

export const payoutProofResponseSchema = z.object({
  payoutId: z.number().int().min(1),
  byteSize: z.number().int().min(1),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  uploadedAt: instant,
  replaced: z.boolean(),
});
export type PayoutProofResponse = z.infer<typeof payoutProofResponseSchema>;
