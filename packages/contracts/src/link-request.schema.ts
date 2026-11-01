/**
 * The Zalo assistant's link request (FR-1, AD-15, Story 5.1), on the internal listener only with
 * `X-Assistant-Token`. The assistant names the customer by id, code or alias and passes the pasted
 * product link as it came; the server answers the queued request's id, which is also its sub_id2
 * (D47). The link itself arrives later, through the link job.
 */
import { z } from "zod";

export const ASSISTANT_TOKEN_HEADER = "x-assistant-token";

export const linkRequestCreateSchema = z.strictObject({
  customer: z.string().trim().min(1).max(64),
  url: z.string().trim().min(1).max(2048),
});
export type LinkRequestCreate = z.infer<typeof linkRequestCreateSchema>;

export const linkRequestCreatedSchema = z.object({
  requestId: z.string().regex(/^[A-Za-z0-9]+$/),
  status: z.literal("QUEUED"),
});
export type LinkRequestCreated = z.infer<typeof linkRequestCreatedSchema>;
