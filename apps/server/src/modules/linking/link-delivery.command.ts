/**
 * A made link reaches its customer once (AD-14, AD-16, FR-4; Story 6.5). A link request becomes
 * DELIVERED the first time a channel actually hands its link over, and never before:
 *
 * - the chat reply claims the link (`claimLinkDelivery`), which holds it for 2 minutes, sends it,
 *   and confirms (`confirmLinkDelivery`); a reply that could not be sent releases the claim, and a
 *   claim never confirmed (the assistant stopped) lapses, so the link is never lost;
 * - the delivery check (`checkLinkDeliveries`, every few seconds) enqueues one "link ready"
 *   notification for a link still ISSUED and unclaimed 55 s after it was requested and younger
 *   than 2 hours; the request becomes DELIVERED when the assistant acknowledges that notification
 *   as sent (`markLinkDelivered`). A notification that will never be sent (recorded while
 *   `messaging.silent` is on, or dropped) is told again under the next key, `<id>.<n>`, once that
 *   can be sent; after three that could not deliver it, the request is closed and the owner warned;
 * - an ISSUED link older than 2 hours is news nobody waits for: it is closed (DELIVERED) with no
 *   message, as is a link no one can be told about (a guest's, D5).
 *
 * Ages count from the request's time, as the live system counted them (notifications.py
 * ASSISTANT_WAIT, STALE_AFTER). A link closed without a message keeps `delivered_at` empty.
 */
import { instantFromMs, toMs, type Clock, type Instant } from "@cashback/core";
import { and, asc, eq, isNull, lte, or } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import type { AlertPort } from "../../platform/ports/alert.port";
import { dedupKey, dedupKeyParts, type OutboxDeliveryLookup, type OutboxPort } from "../../platform/ports/outbox.port";
import { guestCustomerIds, resolveCustomer } from "../identity/index";
import { linkRequests } from "./schema";

/** How long the assistant's own reply may take before the link goes by notification. */
export const LINK_REPLY_WAIT_MS = 55_000;
/** Past this an undelivered link is closed without a message. */
export const LINK_STALE_AFTER_MS = 2 * 60 * 60_000;
/** How long a chat reply's claim holds the link before it lapses back to the delivery check. */
export const LINK_CLAIM_MS = 2 * 60_000;
/** Notification keys tried for one link before it is closed and the owner warned. */
export const LINK_DELIVERY_MAX_ATTEMPTS = 3;
/** The message key of the "link ready" notification; the assistant picks the exact text from the reply facts. */
export const LINK_READY_MESSAGE = "link_ready";
export const LINK_UNDELIVERABLE_ALERT = { kind: "link_undeliverable", severity: "warning" } as const;
/** Requests looked at in one check; the rest wait for the next one. */
const CHECK_BATCH = 50;

/** The notification key of a link's `attempt`-th delivery: `link_request:<id>:delivered`, then `<id>.1`, `<id>.2`. */
export function linkDeliveredKey(requestId: string, attempt = 0): string {
  return dedupKey("link_request", attempt === 0 ? requestId : `${requestId}.${attempt}`, "delivered");
}

/** The request a "link ready" key is about, or null for any other key. */
export function requestOfDeliveredKey(key: string): string | null {
  const { entity, id, event } = dedupKeyParts(key);
  return entity === "link_request" && event === "delivered" ? (id.split(".")[0] ?? null) : null;
}

/** The one ownership rule of a link request: its owner and the asker resolve to the same customer (aliases, merges). */
export function isLinkRequestOf(db: LedgerDb, ownerId: string, customerKey: string): boolean {
  const asker = resolveCustomer(db, customerKey);
  return asker !== null && resolveCustomer(db, ownerId)?.customerId === asker.customerId;
}

/**
 * `claimed`: the reply holds the link now and must confirm it was sent; `delivered`: it was handed
 * over before (a reply to the same product asked again may send it again); `pending`: a
 * notification or another reply is handing it over right now, so this reply must not.
 */
export type LinkClaim = "claimed" | "delivered" | "pending" | "not_made" | "not_found";

const requestRow = (db: LedgerDb, requestId: string) =>
  db
    .select({ status: linkRequests.status, customerId: linkRequests.customerId, claimedUntil: linkRequests.deliveryClaimedUntil, attempt: linkRequests.deliveryAttempt, deliveredAt: linkRequests.deliveredAt })
    .from(linkRequests)
    .where(eq(linkRequests.requestId, requestId))
    .get();

const claimLive = (claimedUntil: string | null, at: Instant): boolean => claimedUntil !== null && claimedUntil > at;

/** The chat reply is about to hand the link over; call inside `tx`. */
export function claimLinkDelivery(db: LedgerDb, requestId: string, customerKey: string, at: Instant, outbox: OutboxDeliveryLookup): LinkClaim {
  const row = requestRow(db, requestId);
  if (row === undefined || !isLinkRequestOf(db, row.customerId, customerKey)) return "not_found";
  if (row.status === "QUEUED" || row.status === "FAILED") return "not_made";
  const notifying = outbox.state(linkDeliveredKey(requestId, row.attempt)) === "pending";
  if (row.status !== "ISSUED") return notifying ? "pending" : "delivered";
  if (notifying || claimLive(row.claimedUntil, at)) return "pending";
  db.update(linkRequests).set({ deliveryClaimedUntil: instantFromMs(toMs(at) + LINK_CLAIM_MS) }).where(eq(linkRequests.requestId, requestId)).run();
  return "claimed";
}

/**
 * The chat reply was sent: the request is DELIVERED; call inside `tx`. Returns the notification key
 * in use, so a notification enqueued after a lapsed claim can be withdrawn before it is sent.
 */
export function confirmLinkDelivery(db: LedgerDb, requestId: string, customerKey: string, at: Instant): string | null {
  const row = requestRow(db, requestId);
  if (row === undefined || !isLinkRequestOf(db, row.customerId, customerKey) || row.status === "QUEUED" || row.status === "FAILED") return null;
  if (row.status === "ISSUED") db.update(linkRequests).set({ status: "DELIVERED", deliveredAt: at, deliveryClaimedUntil: null }).where(eq(linkRequests.requestId, requestId)).run();
  return linkDeliveredKey(requestId, row.attempt);
}

/** The claimed reply could not be sent: the claim ends and the delivery check sends the link; call inside `tx`. */
export function releaseLinkDelivery(db: LedgerDb, requestId: string, customerKey: string): boolean {
  const row = requestRow(db, requestId);
  if (row === undefined || row.status !== "ISSUED" || row.claimedUntil === null || !isLinkRequestOf(db, row.customerId, customerKey)) return false;
  db.update(linkRequests).set({ deliveryClaimedUntil: null }).where(eq(linkRequests.requestId, requestId)).run();
  return true;
}

/** Its "link ready" notification was sent: the request is DELIVERED at `at`; call inside `tx`. */
export function markLinkDelivered(db: LedgerDb, requestId: string, at: Instant): void {
  const row = requestRow(db, requestId);
  if (row === undefined) return;
  if (row.status === "ISSUED") db.update(linkRequests).set({ status: "DELIVERED", deliveredAt: at, deliveryClaimedUntil: null }).where(eq(linkRequests.requestId, requestId)).run();
  else if (row.deliveredAt === null && (row.status === "DELIVERED" || row.status === "CONVERTED")) db.update(linkRequests).set({ deliveredAt: at }).where(eq(linkRequests.requestId, requestId)).run();
}

export interface LinkDeliveryCheck {
  /** Links given to a new notification. */
  readonly notified: number;
  /** Links closed without a message: older than 2 hours, no one to tell, or three notifications failed. */
  readonly closed: number;
}

export interface LinkDeliveryEffects {
  readonly outbox: OutboxPort & OutboxDeliveryLookup;
  readonly alerts: AlertPort;
}

const close = (db: LedgerDb, requestId: string): void => {
  db.update(linkRequests).set({ status: "DELIVERED", deliveryClaimedUntil: null }).where(and(eq(linkRequests.requestId, requestId), eq(linkRequests.status, "ISSUED"))).run();
};

/** One unclaimed ISSUED link: notified, waiting on its notification, or closed. */
function deliver(db: LedgerDb, row: { requestId: string; customerId: string; attempt: number }, now: Instant, effects: LinkDeliveryEffects): "notified" | "waiting" | "closed" {
  let attempt = row.attempt;
  const state = effects.outbox.state(linkDeliveredKey(row.requestId, attempt));
  if (state === "pending" || (state === "silenced" && effects.outbox.silent())) return "waiting";
  if (state === "sent") {
    markLinkDelivered(db, row.requestId, now);
    return "waiting";
  }
  if (state !== "none") {
    attempt++;
    if (attempt >= LINK_DELIVERY_MAX_ATTEMPTS) {
      close(db, row.requestId);
      effects.alerts.alert(LINK_UNDELIVERABLE_ALERT.kind, LINK_UNDELIVERABLE_ALERT.severity);
      return "closed";
    }
    db.update(linkRequests).set({ deliveryAttempt: attempt }).where(eq(linkRequests.requestId, row.requestId)).run();
  }
  const key = linkDeliveredKey(row.requestId, attempt);
  effects.outbox.enqueue({ dedupKey: key, customerId: row.customerId, messageKey: LINK_READY_MESSAGE, params: { requestId: row.requestId } });
  const after = effects.outbox.state(key);
  if (after === "pending") return "notified";
  if (after === "silenced") return "waiting";
  // Refused: no one can be told about this link (a guest, an erased customer).
  close(db, row.requestId);
  return "closed";
}

/** One delivery check over the unclaimed ISSUED links; call inside `tx` with the outbox bound to it. */
export function checkLinkDeliveries(db: LedgerDb, clock: Clock, effects: LinkDeliveryEffects): LinkDeliveryCheck {
  const now = clock.now();
  const claimedBefore = instantFromMs(toMs(now) - LINK_REPLY_WAIT_MS);
  const rows = db
    .select({ requestId: linkRequests.requestId, customerId: linkRequests.customerId, createdAt: linkRequests.createdAt, attempt: linkRequests.deliveryAttempt })
    .from(linkRequests)
    .where(
      and(
        eq(linkRequests.status, "ISSUED"),
        or(isNull(linkRequests.createdAt), lte(linkRequests.createdAt, claimedBefore)),
        or(isNull(linkRequests.deliveryClaimedUntil), lte(linkRequests.deliveryClaimedUntil, now)),
      ),
    )
    .orderBy(asc(linkRequests.createdAt), asc(linkRequests.requestId))
    .limit(CHECK_BATCH)
    .all();
  const guests = new Set(guestCustomerIds(db));
  const stale = (createdAt: string | null): boolean => createdAt === null || toMs(now) - toMs(createdAt as Instant) > LINK_STALE_AFTER_MS;
  let notified = 0;
  let closed = 0;
  for (const row of rows) {
    if (guests.has(row.customerId) || stale(row.createdAt)) {
      close(db, row.requestId);
      closed++;
      continue;
    }
    const outcome = deliver(db, row, now, effects);
    if (outcome === "notified") notified++;
    if (outcome === "closed") closed++;
  }
  return { notified, closed };
}
