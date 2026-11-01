/**
 * The assistant's chat routes (AD-15, AD-18, FR-1, FR-8, D6, D10, D25; Stories 6.2 and 6.3), on
 * the internal listener only, behind `X-Assistant-Token`:
 *
 *   POST /internal/assistant/registrations   a private message: register the sender, or find them again
 *   POST /internal/assistant/link-requests   a pasted link: register the sender when due, queue the request
 *   POST /internal/assistant/link-replies    what the reply to one of the sender's requests says
 *
 * These are the only callers of `registerCustomer`, so only the assistant creates customers (D10).
 * A private message registers its sender whatever it says (with a link, the link-request route
 * registers on the way and says so in `registered`); in the community group only a product link
 * the server supports does (D25), so a member who pastes a Lazada link, or nothing, stays
 * unregistered. The registration commits in its own transaction before the link request is
 * queued. A refused link is an answer, not an error: its reason tells the assistant which reply
 * to send, and `not_a_shop_link` (a link to no shop at all) gets none in the group. The link request is queued for the
 * sender's own customer id (resolved through aliases), so the link carries the sender's sub_id1,
 * never the group's or another member's.
 *
 * The reply carries the share link `/s/<code>` on the public origin, never the affiliate link, and
 * the estimate from the product snapshot under the current Shopee withholding (the share page's
 * rule). It is answered only for a request of the customer named, through the same aliases.
 */
import {
  ASSISTANT_LINK_REPLY_PATH,
  ASSISTANT_LINK_REQUEST_PATH,
  ASSISTANT_REGISTRATION_PATH,
  assistantLinkAnswerSchema,
  assistantLinkReplyQuerySchema,
  assistantLinkReplySchema,
  assistantLinkRequestSchema,
  assistantRegisteredSchema,
  assistantRegistrationSchema,
  type AssistantLinkReply,
  type LinkRefusal,
} from "@cashback/contracts";
import type { Clock } from "@cashback/core";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";

import { CustomerRegisterError, isGuestCustomer, registerCustomer, resolveCustomer, type Registered, type RegistrationChannel } from "../modules/identity/index";
import { isOtherShopLink, LinkRequestError, linkReplyData, linkReplyFactsOf, queueLinkRequest, readProductLink } from "../modules/linking/index";
import { commandAudit } from "../modules/operations/index";
import { periodWithheld, settlementPeriodOf } from "../modules/orders/index";
import type { Ledger, LedgerDb } from "../platform/db/ledger";
import { HttpError } from "../platform/http/error-envelope";
import { ASSISTANT_ROUTE } from "../platform/http/internal-token.guard";
import type { Actor } from "../platform/ports/audit.port";

export const ASSISTANT_ACTOR: Actor = { kind: "assistant", id: "zalo" };

export interface AssistantChatRouteDeps {
  readonly ledger: Ledger;
  readonly clock: Clock;
  /** `DEV` in dev, empty in production (AD-25). */
  readonly requestIdPrefix: string;
  /** False when no AccessTrade link creator is configured (Story 5.7). */
  readonly tikTok: boolean;
  /** The public origin share links are written on (`https://hoantiendp.com`). */
  readonly shareBaseUrl: string;
}

function register(deps: AssistantChatRouteDeps, log: FastifyBaseLogger, zaloUserId: string, displayName: string | null, via: RegistrationChannel): Registered {
  try {
    return deps.ledger.tx((db) => registerCustomer(db, { zaloUserId, displayName, via }, { clock: deps.clock, logger: log, by: commandAudit(db, deps.clock, ASSISTANT_ACTOR) }));
  } catch (error) {
    if (error instanceof CustomerRegisterError) throw new HttpError("invalid_request", `error.registration.${error.code}`);
    throw error;
  }
}

function replyOf(db: LedgerDb, deps: AssistantChatRouteDeps, requestId: string, customerId: string): AssistantLinkReply | null {
  const facts = linkReplyFactsOf(db, requestId);
  const asker = resolveCustomer(db, customerId);
  if (facts === null || asker === null || resolveCustomer(db, facts.customerId)?.customerId !== asker.customerId) return null;
  const withheld = periodWithheld(db, "shopee", settlementPeriodOf(deps.clock.now()));
  const reply = linkReplyData(facts, { guest: isGuestCustomer(db, facts.customerId), withheld });
  const made = facts.shareCode !== null && facts.status !== "QUEUED" && facts.status !== "FAILED";
  const share = reply.estimate?.rates.find((r) => r.part === "customer_share");
  return {
    requestId: facts.requestId,
    status: facts.status,
    shareUrl: made ? `${deps.shareBaseUrl.replace(/\/+$/, "")}/s/${facts.shareCode}` : null,
    factsSettled: facts.factsSettled,
    network: facts.network,
    perShop: reply.perShopKey !== null,
    product: { name: reply.product.name, price: reply.product.price },
    estimate: reply.estimate === null || share === undefined ? null : { cashback: reply.estimate.cashback, shareBps: share.rateBps, withheld: reply.estimate.withheld },
  };
}

export function assistantChatRoutes(deps: AssistantChatRouteDeps): (app: FastifyInstance) => void {
  return (app) => {
    app.post(ASSISTANT_REGISTRATION_PATH, { config: ASSISTANT_ROUTE }, async (request) => {
      const body = assistantRegistrationSchema.safeParse(request.body);
      if (!body.success) throw new HttpError("invalid_request", "error.invalid_request");
      const registered = register(deps, request.log, body.data.zaloUserId, body.data.displayName ?? null, "private_message");
      return assistantRegisteredSchema.parse({ customerId: registered.customerId, customerCode: registered.customerCode, created: registered.created });
    });

    app.post(ASSISTANT_LINK_REQUEST_PATH, { config: ASSISTANT_ROUTE }, async (request) => {
      const body = assistantLinkRequestSchema.safeParse(request.body);
      if (!body.success) throw new HttpError("invalid_request", "error.invalid_request");
      const { zaloUserId, chat, url } = body.data;
      const refuse = (reason: LinkRefusal, sender: Registered | null) =>
        assistantLinkAnswerSchema.parse({ outcome: "refused", reason, customerId: sender?.customerId ?? null, customerCode: sender?.customerCode ?? null, registered: sender?.created ?? false });
      const product = readProductLink(url);
      const notServed: LinkRefusal | null = product.ok ? null : product.reason === "too_long" ? "url_too_long" : isOtherShopLink(url) ? "network_unsupported" : "not_a_shop_link";
      // In the group only a supported product link registers a member (D25).
      if (chat === "group" && notServed !== null) return refuse(notServed, null);
      const sender = register(deps, request.log, zaloUserId, body.data.displayName ?? null, chat === "group" ? "group_link" : "private_message");
      if (notServed !== null) return refuse(notServed, sender);
      try {
        const queued = deps.ledger.tx((db) => queueLinkRequest(db, { customer: sender.customerId, url, channel: "zalo" }, deps.clock, deps.requestIdPrefix, (event, detail) => request.log.warn(detail, event), deps.tikTok));
        return assistantLinkAnswerSchema.parse({ outcome: "queued", customerId: sender.customerId, customerCode: sender.customerCode, registered: sender.created, requestId: queued.requestId, reused: queued.reused });
      } catch (error) {
        if (error instanceof LinkRequestError) return refuse(error.code, sender);
        throw error;
      }
    });

    app.post(ASSISTANT_LINK_REPLY_PATH, { config: ASSISTANT_ROUTE }, async (request) => {
      const body = assistantLinkReplyQuerySchema.safeParse(request.body);
      if (!body.success) throw new HttpError("invalid_request", "error.invalid_request");
      const reply = deps.ledger.tx((db) => replyOf(db, deps, body.data.requestId, body.data.customerId));
      if (reply === null) throw new HttpError("not_found", "error.link.request_not_found");
      return assistantLinkReplySchema.parse(reply);
    });
  };
}
