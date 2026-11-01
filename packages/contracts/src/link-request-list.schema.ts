/**
 * The desk's link requests list (FR-7, FR-25, FR-37, AD-12; Story 5.10): every link request with
 * its queue state, channel, delivery and failed attempts, one value per field, as stored. The owner
 * is the customer code, or the guest account (`guest`), never shown as a customer; the product is
 * the request's snapshot (D56), its image https only. `createdAt` is when the customer asked: the
 * "requested" column shows it and sorts by it.
 */
import { INSTANT_PATTERN } from "@cashback/core";
import { z } from "zod";

import { listResponseSchema } from "./list.schema";

const instant = z.string().regex(INSTANT_PATTERN);

export const DESK_LINK_REQUESTS_PATH = "/api/admin/link-requests";
/** The channels a request is made on (the live import may carry others, shown as they are). */
export const LINK_REQUEST_CHANNELS = ["zalo", "web"] as const;
export const DESK_LINK_REQUEST_NETWORKS = ["shopee", "accesstrade"] as const;

export const deskLinkRequestRowSchema = z.object({
  requestId: z.string(),
  customerCode: z.string().nullable(),
  guest: z.boolean(),
  productName: z.string().nullable(),
  productImageUrl: z.url({ protocol: /^https$/ }).nullable(),
  network: z.enum(DESK_LINK_REQUEST_NETWORKS).nullable(),
  platform: z.string(),
  channel: z.string().nullable(),
  status: z.string(),
  attempts: z.number().int().min(0),
  deliveredAt: instant.nullable(),
  createdAt: instant.nullable(),
});
export type DeskLinkRequestRow = z.infer<typeof deskLinkRequestRowSchema>;

export const deskLinkRequestsResponseSchema = listResponseSchema(deskLinkRequestRowSchema);
