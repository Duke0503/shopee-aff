/**
 * The notification outbox as the Zalo assistant pulls it (AD-15, AD-16, D9, D46; Stories 6.4 and
 * 6.5), on the internal listener only with `X-Assistant-Token`:
 *
 *   GET  /internal/notifications/next        at most one due notification, leased to the assistant
 *   POST /internal/notifications/<id>/ack    sent (or undeliverable: no text for its key)
 *
 * A notification names its message key and its parameters (ids and whole-dong amounts only); a
 * "link ready" one also carries the link reply facts, so the assistant writes the same sentence a
 * chat reply would. The assistant remembers the dedup keys it sent, so a notification handed out
 * again after a crash before its ack is acknowledged without a second send.
 *
 * The link-reply claim, confirm and release (Story 6.5): the assistant claims a link before its
 * chat reply hands it over, so the delivery check leaves it to the reply, confirms once the reply
 * was sent, and gives it back when that send failed; an unconfirmed claim lapses after 2 minutes.
 */
import { z } from "zod";

import { assistantLinkReplySchema } from "./assistant-chat.schema";

export const NOTIFICATION_NEXT_PATH = "/internal/notifications/next";
export const notificationAckPath = (id: number): string => `/internal/notifications/${id}/ack`;
export const NOTIFICATION_ACK_ROUTE = "/internal/notifications/:id/ack";

export const ASSISTANT_LINK_CLAIM_PATH = "/internal/assistant/link-replies/claim";
export const ASSISTANT_LINK_CONFIRM_PATH = "/internal/assistant/link-replies/confirm";
export const ASSISTANT_LINK_RELEASE_PATH = "/internal/assistant/link-replies/release";

const param = z.union([z.string().max(400), z.number().int()]);

export const assistantNotificationSchema = z.object({
  id: z.number().int().positive(),
  dedupKey: z.string().min(5).max(200),
  zaloUserId: z.string().regex(/^[A-Za-z0-9]{1,40}$/),
  messageKey: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  params: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,39}$/), param),
  /** The link reply facts of a "link ready" notification; null for every other one. */
  link: assistantLinkReplySchema.nullable(),
});
export type AssistantNotification = z.infer<typeof assistantNotificationSchema>;

export const notificationNextSchema = z.object({ notification: assistantNotificationSchema.nullable() });
export type NotificationNext = z.infer<typeof notificationNextSchema>;

export const NOTIFICATION_ACK_RESULTS = ["sent", "undeliverable"] as const;
export const notificationAckSchema = z.strictObject({ result: z.enum(NOTIFICATION_ACK_RESULTS) });
export type NotificationAck = z.infer<typeof notificationAckSchema>;

export const notificationAckedSchema = z.object({ id: z.number().int().positive(), outcome: z.enum(["sent", "already_sent", "dropped"]) });
export type NotificationAcked = z.infer<typeof notificationAckedSchema>;

const requestId = z.string().regex(/^[A-Za-z0-9]{1,64}$/);
const customerId = z.string().regex(/^[A-Za-z0-9]{1,64}$/);

export const assistantLinkClaimSchema = z.strictObject({ requestId, customerId });
export type AssistantLinkClaim = z.infer<typeof assistantLinkClaimSchema>;
/**
 * `claimed`: the reply holds the link for 2 minutes and confirms once it was sent; `delivered`: it
 * was handed over before (only a reply to the same product asked again sends it again);
 * `pending`: a notification or another reply is handing it over now; `not_made`: no link yet.
 */
export const LINK_CLAIMS = ["claimed", "delivered", "pending", "not_made"] as const;
export const assistantLinkClaimedSchema = z.object({ claim: z.enum(LINK_CLAIMS) });
export type AssistantLinkClaimed = z.infer<typeof assistantLinkClaimedSchema>;
export const assistantLinkReleasedSchema = z.object({ released: z.boolean() });
export const assistantLinkConfirmedSchema = z.object({ confirmed: z.boolean() });
export type AssistantLinkReleased = z.infer<typeof assistantLinkReleasedSchema>;

/** The owner's switch of `messaging.silent` (Story 6.10), an admin command of the internal CLI. */
export const MESSAGING_SILENT_PATH = "/internal/admin/messaging/silent";
export const messagingSilentSchema = z.strictObject({ silent: z.boolean() });
export const messagingSilentSetSchema = z.object({ silent: z.boolean(), changed: z.boolean() });
export type MessagingSilentSet = z.infer<typeof messagingSilentSetSchema>;
