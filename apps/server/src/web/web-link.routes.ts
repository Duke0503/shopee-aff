/**
 * The home page's link converter on the public listener (FR-2, FR-3, AD-14, AD-18, D5, D6, D10,
 * INV-1, INV-6; Story 7.6):
 *
 *   POST /api/links           queue one link and answer a ticket
 *   GET  /api/links/<ticket>  what the request has become; the page polls, the server waits
 *
 * Whose link it is: the signed-in customer's (the session wins over anything typed); else the
 * customer a typed code resolves to, an active customer of the service (USER) only; else the guest
 * account (HOUSE), whose link earns nothing and tells nobody (D5). A typed code that names no such
 * customer is `not_found` under the field, never a guest link, and no customer is created: this
 * route never registers anyone (D10, INV-6). The request is queued by `queueLinkRequest` for that
 * customer alone, with its reuse rule (D6); a new request first passes the website quota
 * (`webLinkQuota`: per client for a guest or a typed code, per customer once signed in, and a
 * safety cap over everyone that also alerts the owner), and beyond it the answer is
 * `rate_limited` / `error.link.web_busy`, which the page shows as the Zalo hand-off.
 *
 * The ticket is the request id and an HMAC of it, so nobody reads a request by guessing the next
 * id. The result carries the share path `/s/<code>` (the in-app browser hand-off runs there),
 * never the affiliate link, and the estimate from `linkReplyData` under the current Shopee
 * withholding, as the chat reply and the share page say it. A made link counts as handed over
 * only when its own customer, signed in, sees it: it is claimed and confirmed like a chat reply
 * (Story 6.5), so no Zalo message repeats it. A guest's view, or a signed-out visitor who typed a
 * code, never touches delivery, so typing someone's code cannot withdraw their Zalo message.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { CUSTOMER_CODE_INPUT, WEB_LINK_PATH, webLinkQueuedSchema, webLinkRequestSchema, webLinkResultSchema, type WebLinkResult } from "@cashback/contracts";
import type { Clock } from "@cashback/core";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { customerCodeOf, customerSessionOf, guestCustomerIds, isGuestCustomer, resolveCustomer, signInCode } from "../modules/identity/index";
import { claimLinkDelivery, confirmLinkDelivery, LinkRequestError, linkReplyData, linkReplyFactsOf, queueLinkRequest, WEB_LINK_CAP_ALERT, webLinkQuota, type LinkReplyFacts, type WebAccess, type WebLinkQuota } from "../modules/linking/index";
import { isSilent, keyState, withdrawPendingNotification } from "../modules/messaging/index";
import { alertsFor } from "../modules/operations/index";
import { periodWithheld, settlementPeriodOf } from "../modules/orders/index";
import type { Ledger, LedgerDb } from "../platform/db/ledger";
import { HttpError } from "../platform/http/error-envelope";
import { requireOrigin } from "../platform/http/origin.guard";
import type { PublicRoutes } from "../platform/http/servers";
import { CUSTOMER_SESSION_COOKIE, readCookie } from "../platform/http/session-cookie";
import type { Logger } from "../platform/log/logger";

export interface WebLinkRouteDeps {
  readonly ledger: Ledger;
  readonly clock: Clock;
  readonly origins: readonly string[];
  /** `DEV` in dev, empty in production (AD-25). */
  readonly requestIdPrefix: string;
  /** False when no AccessTrade link creator is configured (Story 5.7). */
  readonly tikTok: boolean;
  /** The secret tickets are signed with. */
  readonly ticketSecret: string;
  /** The HMAC of the caller's address (platform/http/client-key.ts), the quota's key. */
  readonly clientKey: (request: FastifyRequest) => string;
  readonly logger?: Logger;
}

const REFUSAL_STATUS = {
  customer_not_found: "not_found",
  customer_disabled: "forbidden",
  customer_id_unusable: "forbidden",
  network_unsupported: "invalid_request",
  tiktok_unavailable: "invalid_request",
  url_too_long: "invalid_request",
  day_full: "busy",
} as const;

class WebBusy extends Error {
  constructor(readonly limit: Exclude<WebLinkQuota, "ok">) {
    super(limit);
  }
}

const TICKET_MAC = 24;
const macOf = (secret: string, requestId: string): string => createHmac("sha256", secret).update(`web-link:${requestId}`).digest("base64url").slice(0, TICKET_MAC);

export const ticketOf = (secret: string, requestId: string): string => `${requestId}.${macOf(secret, requestId)}`;

const TICKET = /^([A-Za-z0-9]{1,40})\.([A-Za-z0-9_-]{24})$/;

/** The request id a ticket names, or null for a malformed ticket or one this server did not sign. */
export function requestOfTicket(secret: string, ticket: string): string | null {
  const parts = TICKET.exec(ticket);
  if (parts === null) return null;
  const [, requestId = "", mac = ""] = parts;
  // Both are 24 ASCII characters here, so the buffers have the same byte length.
  return timingSafeEqual(Buffer.from(mac, "ascii"), Buffer.from(macOf(secret, requestId), "ascii")) ? requestId : null;
}

const unknownCode = (): HttpError => new HttpError("not_found", "error.web_link.customer_unknown", { customerCode: "error.web_link.customer_unknown" });

const viewerOf = (db: LedgerDb, request: FastifyRequest, clock: Clock): string | null => customerSessionOf(db, readCookie(request.headers.cookie, CUSTOMER_SESSION_COOKIE), clock);

/** Whose link this is and how it was asked for: the session's customer, the typed code's, or the guest account. */
function ownerOf(db: LedgerDb, request: FastifyRequest, typed: string, clock: Clock): { customerId: string; guest: boolean; access: WebAccess } {
  const signedIn = viewerOf(db, request, clock);
  if (signedIn !== null) return { customerId: signedIn, guest: false, access: "SESSION" };
  if (typed.trim() !== "") {
    const code = CUSTOMER_CODE_INPUT.test(typed) ? signInCode(typed) : null;
    const customer = code === null ? null : resolveCustomer(db, code);
    if (customer === null || customer.role !== "USER" || customerCodeOf(db, customer.customerId) === null) throw unknownCode();
    return { customerId: customer.customerId, guest: false, access: "CODE" };
  }
  const guest = guestCustomerIds(db)[0];
  if (guest === undefined) throw new HttpError("internal", "error.internal");
  return { customerId: guest, guest: true, access: "GUEST" };
}

function stateOf(facts: LinkReplyFacts): WebLinkResult["state"] {
  if (facts.status === "FAILED") return "failed";
  return facts.status === "QUEUED" || facts.shareCode === null ? "creating" : "ready";
}

/** The signed-in `viewer` sees their own made link: it is handed over, as a chat reply would confirm it; anyone else's view changes nothing. */
function handOver(db: LedgerDb, facts: LinkReplyFacts, viewer: string, clock: Clock): void {
  const now = clock.now();
  // The claim checks that the viewer resolves to the request's customer (aliases, merges).
  const claim = claimLinkDelivery(db, facts.requestId, viewer, now, { state: (key) => keyState(db, key), silent: () => isSilent(db) });
  if (claim !== "claimed") return;
  const key = confirmLinkDelivery(db, facts.requestId, viewer, now);
  if (key !== null) withdrawPendingNotification(db, key, now);
}

/** What one request has become, for the page; `viewer` is the signed-in customer looking, or null. */
export function webLinkResultOf(db: LedgerDb, requestId: string, viewer: string | null, clock: Clock): WebLinkResult | null {
  const facts = linkReplyFactsOf(db, requestId);
  if (facts === null) return null;
  const guest = isGuestCustomer(db, facts.customerId);
  const reply = linkReplyData(facts, { guest, withheld: periodWithheld(db, "shopee", settlementPeriodOf(clock.now())) });
  const state = stateOf(facts);
  if (state === "ready" && !guest && viewer !== null) handOver(db, facts, viewer, clock);
  return {
    state,
    guest,
    factsSettled: facts.factsSettled,
    network: facts.network,
    perShop: reply.perShopKey !== null,
    product: { name: reply.product.name, imageUrl: reply.product.imageUrl, price: reply.product.price },
    estimate: reply.estimate === null ? null : { cashback: reply.estimate.cashback, withheld: reply.estimate.withheld },
    sharePath: state === "ready" ? `/s/${facts.shareCode}` : null,
  };
}

function queueRoute(app: FastifyInstance, deps: WebLinkRouteDeps): void {
  app.post(WEB_LINK_PATH, async (request, reply) => {
    void reply.header("cache-control", "no-store");
    requireOrigin(request, deps.origins);
    const body = webLinkRequestSchema.safeParse(request.body);
    if (!body.success) throw new HttpError("invalid_request", "error.invalid_request");
    const clientKey = deps.clientKey(request);
    try {
      const queued = deps.ledger.tx((db) => {
        const owner = ownerOf(db, request, body.data.customerCode ?? "", deps.clock);
        const asker = { access: owner.access, customerId: owner.customerId, clientKey };
        const allow = (): void => {
          const quota = webLinkQuota(db, asker, deps.clock);
          if (quota !== "ok") throw new WebBusy(quota);
        };
        const input = { customer: owner.customerId, url: body.data.url.trim(), channel: "web" as const, web: { access: owner.access, clientKey } };
        const made = queueLinkRequest(db, input, deps.clock, deps.requestIdPrefix, (event, detail) => request.log.warn(detail, event), deps.tikTok, allow);
        return { ...made, guest: owner.guest, customerCode: owner.guest ? null : customerCodeOf(db, owner.customerId) };
      });
      request.log.info({ requestId: queued.requestId, reused: queued.reused, guest: queued.guest }, "linking.web_link.queued");
      return webLinkQueuedSchema.parse({ ticket: ticketOf(deps.ticketSecret, queued.requestId), guest: queued.guest, customerCode: queued.customerCode });
    } catch (error) {
      if (error instanceof WebBusy) {
        request.log.warn({ limit: error.limit }, "linking.web_link.busy");
        // The refused request's transaction rolled back; the owner's alert is its own write.
        if (error.limit === "safety_cap") deps.ledger.tx((db) => alertsFor(db, deps.clock, deps.logger).alert(WEB_LINK_CAP_ALERT.kind, WEB_LINK_CAP_ALERT.severity));
        throw new HttpError("rate_limited", "error.link.web_busy");
      }
      if (error instanceof LinkRequestError) throw new HttpError(REFUSAL_STATUS[error.code], `error.link.${error.code}`);
      throw error;
    }
  });
}

export function webLinkRoutes(deps: WebLinkRouteDeps): PublicRoutes {
  return (app) => {
    queueRoute(app, deps);
    app.get<{ Params: { ticket: string } }>(`${WEB_LINK_PATH}/:ticket`, async (request, reply) => {
      void reply.header("cache-control", "no-store");
      const requestId = requestOfTicket(deps.ticketSecret, request.params.ticket);
      const result = requestId === null ? null : deps.ledger.tx((db) => webLinkResultOf(db, requestId, viewerOf(db, request, deps.clock), deps.clock));
      if (result === null) throw new HttpError("not_found", "error.link.request_not_found");
      return webLinkResultSchema.parse(result);
    });
  };
}
