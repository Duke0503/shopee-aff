/**
 * The Zalo assistant's link request (FR-1, AD-15, Story 5.1), on the internal listener only with
 * `X-Assistant-Token`. The assistant names the customer by id, code or alias and passes the pasted
 * product link as it came; the server answers the queued request's id, which is also its sub_id2
 * (D47). The link itself arrives later, through the link job. A repeat request for the same
 * product inside the attribution window gets the customer's own earlier request back (`reused`),
 * with its share code once it has one (Story 5.2).
 */
import { SHOPEE_PASTE_MAX_LENGTH } from "@cashback/core";
import { z } from "zod";

export const ASSISTANT_TOKEN_HEADER = "x-assistant-token";

export const linkRequestCreateSchema = z.strictObject({
  customer: z.string().trim().min(1).max(64),
  // A pasted product link may carry a long encoded name; the server keeps only its ids (Story 5.3 review item 1).
  url: z.string().trim().min(1).max(SHOPEE_PASTE_MAX_LENGTH),
});
export type LinkRequestCreate = z.infer<typeof linkRequestCreateSchema>;

export const linkRequestCreatedSchema = z.object({
  requestId: z.string().regex(/^[A-Za-z0-9]+$/),
  status: z.enum(["QUEUED", "ISSUED", "DELIVERED", "CONVERTED"]),
  reused: z.boolean(),
  shareCode: z.string().regex(/^[A-Za-z0-9]{8}([A-Za-z0-9]{2})?$/).nullable(),
});
export type LinkRequestCreated = z.infer<typeof linkRequestCreatedSchema>;
