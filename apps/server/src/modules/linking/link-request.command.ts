/**
 * Queueing a link request (AD-14, FR-1, D6, D7; Story 5.1). The request is written QUEUED for the
 * customer the key resolves to (through aliases and merges, never an erased record) and for good:
 * a request never moves to another customer. Its id is its sub_id2 (D47), so it is letters and
 * digits only: the live form `YYMMDD` (Vietnam date) and a five-digit number for the day, above
 * every id already used that day, imported ones included. In dev the id starts with `DEV`
 * (AD-25), so a dev request id can never name a production request. A disabled customer gets no
 * new link. The link job serves the request later.
 */
import { vnToday, type Clock } from "@cashback/core";
import { sql } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { resolveCustomer } from "../identity/index";
import { shopeeProductUrl, SUB_ID_PATTERN } from "./domain/product-url";
import { linkRequests } from "./schema";

/** Where a request came from; the link job serves Zalo first, then the web, then guests (AD-14). */
export const LINK_CHANNELS = ["zalo", "web"] as const;
export type LinkChannel = (typeof LINK_CHANNELS)[number];

export type LinkRequestErrorCode = "customer_not_found" | "customer_disabled" | "network_unsupported" | "customer_id_unusable" | "day_full";

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
  readonly status: "QUEUED";
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

/** Writes one QUEUED request; call inside `tx`. `requestIdPrefix` is `DEV` in dev, empty in production. */
export function queueLinkRequest(db: LedgerDb, input: LinkRequestInput, clock: Clock, requestIdPrefix = ""): QueuedLinkRequest {
  const customer = resolveCustomer(db, input.customer);
  if (customer === null) throw new LinkRequestError("customer_not_found");
  if (customer.status === "DISABLED") throw new LinkRequestError("customer_disabled");
  if (!SUB_ID_PATTERN.test(customer.customerId)) throw new LinkRequestError("customer_id_unusable");
  const sourceUrl = shopeeProductUrl(input.url);
  if (sourceUrl === null) throw new LinkRequestError("network_unsupported");
  const requestId = nextRequestId(db, clock, requestIdPrefix);
  db.insert(linkRequests)
    .values({ requestId, customerId: customer.customerId, network: "shopee", platform: "shopee", channel: input.channel, status: "QUEUED", sourceUrl, createdAt: clock.now(), origin: "REQUEST" })
    .run();
  return { requestId, customerId: customer.customerId, status: "QUEUED" };
}

