/**
 * What the Zalo assistant asks the server about a person who wrote (AD-15, FR-1, FR-8, D10, D25;
 * Stories 6.2 and 6.3), on the internal listener only with `X-Assistant-Token`.
 *
 * - Registration: a private message from someone the server does not know registers them with
 *   the next customer code (the only way a customer is created, D10); a known person, an alias
 *   of a merged customer included, gets the survivor back.
 * - Link request: a product link pasted in the private chat or the community group. The sender
 *   is registered on the way (a private message always; in the group only when the text is a
 *   product link the server supports, D25) and the request is queued for that sender alone, so
 *   the link carries the sender's own sub_id1 (D6).
 * - Link reply: what the reply to one request says once its link is made: the share link (never
 *   the affiliate link), the product, the price and the estimated cashback with its share. Asked
 *   with the customer's id, so a request of another customer is never answered.
 *
 * Amounts are whole dong; the assistant writes the sentences from packages/labels by key.
 */
import { SHOPEE_PASTE_MAX_LENGTH } from "@cashback/core";
import { z } from "zod";

export const ASSISTANT_REGISTRATION_PATH = "/internal/assistant/registrations";
export const ASSISTANT_LINK_REQUEST_PATH = "/internal/assistant/link-requests";
export const ASSISTANT_LINK_REPLY_PATH = "/internal/assistant/link-replies";

const zaloUserId = z.string().regex(/^[A-Za-z0-9]{1,40}$/);
const displayName = z.string().trim().max(120).nullable().optional();
const customerId = z.string().regex(/^[A-Za-z0-9]{1,64}$/);
const requestId = z.string().regex(/^[A-Za-z0-9]{1,64}$/);
const customerCode = z.string().regex(/^DP\d{5,}$/).nullable();

/**
 * `claimedCode`: an older customer code the person wrote in the private chat (Story 6.11). It is
 * recorded as a merge claim for the admin, never merged by itself; `claim` says what became of it.
 */
export const assistantRegistrationSchema = z.strictObject({ zaloUserId, displayName, claimedCode: z.string().regex(/^DP\d{5,}$/).optional() });
export type AssistantRegistration = z.infer<typeof assistantRegistrationSchema>;

export const MERGE_CLAIM_RESULTS = ["recorded", "known", "own", "not_found"] as const;

export const assistantRegisteredSchema = z.object({ customerId, customerCode, created: z.boolean(), claim: z.enum(MERGE_CLAIM_RESULTS).nullable().optional() });
export type AssistantRegistered = z.infer<typeof assistantRegisteredSchema>;

export const ASSISTANT_CHATS = ["private", "group"] as const;
export type AssistantChat = (typeof ASSISTANT_CHATS)[number];

export const assistantLinkRequestSchema = z.strictObject({
  zaloUserId,
  displayName,
  chat: z.enum(ASSISTANT_CHATS),
  url: z.string().trim().min(1).max(SHOPEE_PASTE_MAX_LENGTH),
});
export type AssistantLinkRequest = z.infer<typeof assistantLinkRequestSchema>;

/** The most characters of a Zalo display name the server keeps; the assistant cuts a longer one before sending. */
export const DISPLAY_NAME_MAX_LENGTH = 120;

/**
 * Why a pasted link gets no request. `not_a_shop_link`: a link to no shop at all (a news page),
 * which the assistant leaves unanswered in the group; the others each have their own reply.
 */
export const LINK_REFUSALS = ["network_unsupported", "not_a_shop_link", "url_too_long", "tiktok_unavailable", "customer_disabled", "customer_not_found", "customer_id_unusable", "day_full"] as const;
export type LinkRefusal = (typeof LINK_REFUSALS)[number];

/**
 * The answer to a pasted link: queued (or the sender's own earlier request handed back), or
 * refused with its reason. Either way `registered` says whether this message registered the
 * sender (a private message always registers; in the group only a supported product link does),
 * so the assistant decides the welcome from this one call.
 */
export const assistantLinkAnswerSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("queued"), customerId, customerCode, registered: z.boolean(), requestId, reused: z.boolean(), status: z.enum(["QUEUED", "ISSUED", "DELIVERED", "CONVERTED"]) }),
  z.object({ outcome: z.literal("refused"), reason: z.enum(LINK_REFUSALS), customerId: customerId.nullable(), customerCode, registered: z.boolean() }),
]);
export type AssistantLinkAnswer = z.infer<typeof assistantLinkAnswerSchema>;

export const assistantLinkReplyQuerySchema = z.strictObject({ requestId, customerId });
export type AssistantLinkReplyQuery = z.infer<typeof assistantLinkReplyQuerySchema>;

export const assistantLinkReplySchema = z.object({
  requestId,
  status: z.enum(["QUEUED", "ISSUED", "DELIVERED", "CONVERTED", "FAILED"]),
  /** `https://hoantiendp.com/s/<code>` once the link is made; null before. */
  shareUrl: z.string().max(200).nullable(),
  /** True once the product facts are known or no lookup will add any: the reply need not wait. */
  factsSettled: z.boolean(),
  /** True while no link is made and the Shopee queue is stopped by a captcha or a lost login: the assistant stops waiting (D65). Absent otherwise. */
  queueStopped: z.boolean().optional(),
  network: z.enum(["shopee", "accesstrade"]),
  /** A ShopeeFood link: cashback counted per shop, never an amount (D60). */
  perShop: z.boolean(),
  product: z.object({ name: z.string().max(400).nullable(), price: z.number().int().min(0).nullable() }),
  /** The estimated cashback and the customer's share of the net it is (each percentage with its amount); null shows no amount. */
  estimate: z
    .object({
      cashback: z.number().int().min(0),
      shareBps: z.number().int().min(0).max(10_000),
      withheld: z.boolean(),
      /**
       * The commission parts the live assistant listed under "commission now" (Shopee's rate of the
       * price and the shop's XTRA rate, each with its amount), and whether Shopee's part hit the cap.
       * Absent from a server older than the message parity (2026-11-02): the reply lists none.
       */
      parts: z.array(z.object({ part: z.enum(["shopee", "seller"]), rateBps: z.number().int().min(0).max(10_000), amount: z.number().int().min(0) })).max(2).optional(),
      capped: z.boolean().optional(),
    })
    .nullable(),
});
export type AssistantLinkReply = z.infer<typeof assistantLinkReplySchema>;

/**
 * Friend check: someone sent the assistant's account a friend request, and the assistant asks
 * before accepting it. `accept` is false for the guest account (HOUSE, D5) and a disabled
 * customer; true for anyone else, a person the server does not know included (nobody is
 * registered by the check, D10).
 */
export const ASSISTANT_FRIEND_CHECK_PATH = "/internal/assistant/friend-checks";
export const assistantFriendCheckSchema = z.strictObject({ zaloUserId });
export type AssistantFriendCheck = z.infer<typeof assistantFriendCheckSchema>;
export const assistantFriendCheckedSchema = z.object({ accept: z.boolean() });
export type AssistantFriendChecked = z.infer<typeof assistantFriendCheckedSchema>;
