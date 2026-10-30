import { z } from "zod";
import { Platform } from "./platform";

/** One customer asking for one product link. */
export const LinkRequestStatus = z.enum([
  "pending",
  "converted",
  "expired",
  "failed",
  "ready",
  "success",
]);
export type LinkRequestStatus = z.infer<typeof LinkRequestStatus>;

/** The link request id: "R" + YYMMDD + five random digits, e.g. R26100612345. */
export const RequestId = z.string().regex(/^R\d{11}$/);

/** The share code on our own short link: 8 letters and digits, e.g. aZ3k9QpL. */
export const ShareCode = z.string().regex(/^[a-zA-Z0-9]{8}$/);

export const LinkRequest = z.object({
  requestId: RequestId,
  customerId: z.string().min(1),
  sourceUrl: z.string().url(),
  affiliateUrl: z.string().url().nullable().optional(),
  platform: Platform,
  status: LinkRequestStatus,
  shareCode: ShareCode.nullable().optional(),
  estimatedCashback: z.number().int().nonnegative().nullable().optional(),
  notifiedAt: z.string().nullable().optional(),
});
export type LinkRequest = z.infer<typeof LinkRequest>;
