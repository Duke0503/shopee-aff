/**
 * Queueing a link request (AD-14, FR-1, D6, D7; Story 5.1). The request is written QUEUED for the
 * customer the key resolves to (through aliases and merges, never an erased record) and for good:
 * a request never moves to another customer. Its id is its sub_id2 (D47), so it is letters and
 * digits only: the live form `YYMMDD` (Vietnam date) and a five-digit number for the day, above
 * every id already used that day, imported ones included. In dev the id starts with `DEV`
 * (AD-25), so a dev request id can never name a production request. A disabled customer gets no
 * new link. The link job serves the request later.
 *
 * Before a request is written, the reuse rule of domain/link-reuse.ts runs (Story 5.2, D5, D6,
 * D23): the requester's own live request for the same product inside the attribution window (any
 * time for the guest account) is handed back instead, with its share code once it has one, and no
 * new request or bridge job is made. The lookup is by product key and by the requester's own keys
 * only, so another customer's link can never match (INV-1). A product link is kept in its short
 * canonical form (packages/core `readShopeeProduct`), so it always fits a bridge job; any other
 * Shopee link longer than a bridge job allows is refused here (`url_too_long`), never queued.
 *
 * A TikTok Shop link is queued for AccessTrade (Story 5.7); a Lazada link, or any other, is refused
 * as `network_unsupported`, whose message names the supported networks (D17). Without an AccessTrade
 * link creator (production with no key) a TikTok Shop link is refused as `tiktok_unavailable`.
 */
import { vnToday, type Clock } from "@cashback/core";
import { and, eq, inArray, sql } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { customerKeys, resolveCustomer } from "../identity/index";
import { chooseReusable, unreadableTimes, type ReuseCandidate } from "./domain/link-reuse";
import { readProductLink, SUB_ID_PATTERN } from "./domain/product-url";
import { linkRequests, shareCodes } from "./schema";

/** Where a request came from; the link job serves Zalo first, then the web, then guests (AD-14). */
export const LINK_CHANNELS = ["zalo", "web"] as const;
export type LinkChannel = (typeof LINK_CHANNELS)[number];

export type LinkRequestErrorCode = "customer_not_found" | "customer_disabled" | "network_unsupported" | "tiktok_unavailable" | "customer_id_unusable" | "url_too_long" | "day_full";

export class LinkRequestError extends Error {
  constructor(readonly code: LinkRequestErrorCode) {
    super(`link request refused: ${code}`);
    this.name = "LinkRequestError";
  }
}

export interface LinkRequestInput {
  /** A customer id, customer code or alias; the guest account is `HOUSE`. */
  readonly customer: string;
  readonly url: string;
  readonly channel: LinkChannel;
}

export interface QueuedLinkRequest {
  readonly requestId: string;
  readonly customerId: string;
  /** QUEUED for a new request; a reused one keeps its own status. */
  readonly status: Exclude<ReuseCandidate["status"], "FAILED">;
  /** True when the requester's own earlier request was handed back (Story 5.2). */
  readonly reused: boolean;
  /** The reused request's share code, once it has one. */
  readonly shareCode: string | null;
}

const DAY_SEQUENCE_DIGITS = 5;

/** The next request id of the Vietnam day: `prefix`, `YYMMDD` and five digits. */
export function nextRequestId(db: LedgerDb, clock: Clock, prefix = ""): string {
  const day = `${prefix}${vnToday(clock).slice(2).replaceAll("-", "")}`;
  const pattern = `${day}${"[0-9]".repeat(DAY_SEQUENCE_DIGITS)}`;
  const top = db
    .select({ id: sql<string | null>`max(${linkRequests.requestId})` })
    .from(linkRequests)
    .where(sql`${linkRequests.requestId} GLOB ${pattern}`)
    .get();
  const next = top?.id ? Number(top.id.slice(day.length)) + 1 : 1;
  if (next >= 10 ** DAY_SEQUENCE_DIGITS) throw new LinkRequestError("day_full");
  return `${day}${String(next).padStart(DAY_SEQUENCE_DIGITS, "0")}`;
}

interface Requester {
  readonly customerId: string;
  readonly guest: boolean;
}

/** The requester's own request to hand back for this product, or null (Story 5.2). */
/** A log line the command asks its caller to write (ids only); the command itself does no I/O. */
export type LinkRequestNote = (event: "linking.link_reuse.unreadable_time", detail: { requestIds: string[] }) => void;

function reusableRequest(db: LedgerDb, requester: Requester, productKey: string, clock: Clock, requestIdPrefix: string, note: LinkRequestNote): QueuedLinkRequest | null {
  const ownerKeys = customerKeys(db, requester.customerId)?.keys ?? [requester.customerId];
  const candidates = db
    .select({ requestId: linkRequests.requestId, customerId: linkRequests.customerId, status: linkRequests.status, origin: linkRequests.origin, createdAt: linkRequests.createdAt, affiliateUrl: linkRequests.affiliateUrl })
    .from(linkRequests)
    .where(and(eq(linkRequests.productKey, productKey), inArray(linkRequests.customerId, ownerKeys)))
    .all()
    .map((r): ReuseCandidate => ({ ...r, hasLink: r.affiliateUrl !== null && r.affiliateUrl !== "" }));
  const rule = { ownerKeys, guest: requester.guest, now: clock.now(), requestIdPrefix };
  const unreadable = unreadableTimes(candidates, rule);
  if (unreadable.length > 0) note("linking.link_reuse.unreadable_time", { requestIds: unreadable });
  const chosen = chooseReusable(candidates, rule);
  if (chosen === null || chosen.status === "FAILED") return null;
  const code = db.select({ code: shareCodes.code }).from(shareCodes).where(eq(shareCodes.requestId, chosen.requestId)).get();
  return { requestId: chosen.requestId, customerId: requester.customerId, status: chosen.status, reused: true, shareCode: code?.code ?? null };
}

/**
 * Writes one QUEUED request, or hands back the requester's own reusable one; call inside `tx`.
 * `requestIdPrefix` is `DEV` in dev, empty in production.
 */
export function queueLinkRequest(db: LedgerDb, input: LinkRequestInput, clock: Clock, requestIdPrefix = "", note: LinkRequestNote = () => undefined, tikTok = true): QueuedLinkRequest {
  const customer = resolveCustomer(db, input.customer);
  if (customer === null) throw new LinkRequestError("customer_not_found");
  if (customer.status === "DISABLED") throw new LinkRequestError("customer_disabled");
  if (!SUB_ID_PATTERN.test(customer.customerId)) throw new LinkRequestError("customer_id_unusable");
  const product = readProductLink(input.url);
  if (!product.ok) throw new LinkRequestError(product.reason === "too_long" ? "url_too_long" : "network_unsupported");
  // Production without an AccessTrade key cannot make a TikTok Shop link, so it says so at once (owner decision, Sprint 22 review).
  if (product.network === "accesstrade" && !tikTok) throw new LinkRequestError("tiktok_unavailable");
  const { sourceUrl, productKey, network, platform } = product;
  // Only a link that names one product is ever reused (Story 5.2); a search or shop link is always new.
  const reused = productKey === null ? null : reusableRequest(db, { customerId: customer.customerId, guest: customer.role === "HOUSE" }, productKey, clock, requestIdPrefix, note);
  if (reused !== null) return reused;
  const requestId = nextRequestId(db, clock, requestIdPrefix);
  db.insert(linkRequests)
    .values({ requestId, customerId: customer.customerId, network, platform, channel: input.channel, status: "QUEUED", sourceUrl, productKey, createdAt: clock.now(), origin: "REQUEST" })
    .run();
  return { requestId, customerId: customer.customerId, status: "QUEUED", reused: false, shareCode: null };
}
