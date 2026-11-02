/**
 * The link converter on the website's home page (FR-2, FR-3, AD-14, AD-18, D5, D6, D10, INV-1,
 * INV-6; Story 7.6), on the public listener:
 *
 *   POST /api/links           queue a link: the signed-in customer's, a typed customer code's, or a guest link
 *   GET  /api/links/<ticket>  what that request has become; the page polls while the server works
 *
 * A signed-in customer's link is always their own (the session wins over a typed code). A typed
 * code that names no customer is `not_found` with the field error, never a guest link, and nobody
 * is created (D10). No code at all is a guest link (HOUSE): no cashback, no estimate, no message
 * (D5). The ticket is the request id with a signature, so a request cannot be read by guessing
 * the next id. The answer carries the share path `/s/<code>`, never the affiliate link.
 * Written with zod/mini like every website contract (Story 7.1 AC3).
 */
import { z } from "zod/mini";

export const WEB_LINK_PATH = "/api/links";
export const webLinkPath = (ticket: string): string => `${WEB_LINK_PATH}/${encodeURIComponent(ticket)}`;
export const WEB_LINK_URL_MAX = 2048;
/** How often the page asks again while the link is being made. */
export const WEB_LINK_POLL_MS = 1500;

export const webLinkRequestSchema = z.strictObject({
  url: z.string().check(z.maxLength(WEB_LINK_URL_MAX)),
  /** A signed-out visitor's own customer code; empty or absent for a guest link. */
  customerCode: z.optional(z.string().check(z.maxLength(32))),
});
export type WebLinkRequest = z.infer<typeof webLinkRequestSchema>;

export const webLinkQueuedSchema = z.object({
  ticket: z.string().check(z.minLength(1)),
  guest: z.boolean(),
  /** The customer the link is for; null for a guest link. */
  customerCode: z.nullable(z.string()),
});
export type WebLinkQueued = z.infer<typeof webLinkQueuedSchema>;

export const WEB_LINK_STATES = ["creating", "ready", "failed"] as const;

export const webLinkResultSchema = z.object({
  state: z.enum(WEB_LINK_STATES),
  guest: z.boolean(),
  /** False while the product lookup may still add the price and rate. */
  factsSettled: z.boolean(),
  network: z.enum(["shopee", "accesstrade"]),
  /** A ShopeeFood link: no amount, cashback is counted per shop once approved (D60). */
  perShop: z.boolean(),
  product: z.object({ name: z.nullable(z.string()), imageUrl: z.nullable(z.string()), price: z.nullable(z.int().check(z.minimum(0))) }),
  /** The server's estimate of the customer's cashback; null for a guest, a shop link or no rate. */
  estimate: z.nullable(z.object({ cashback: z.int().check(z.minimum(0)), withheld: z.boolean() })),
  /** `/s/<code>` once the link is made. */
  sharePath: z.nullable(z.string().check(z.regex(/^\/s\/[A-Za-z0-9]{4,32}$/))),
});
export type WebLinkResult = z.infer<typeof webLinkResultSchema>;
