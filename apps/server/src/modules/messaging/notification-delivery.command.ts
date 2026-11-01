/**
 * Delivering the outbox by pull and acknowledgement (AD-15, AD-16, D9, D46; Story 6.4). The
 * assistant asks for the next row; it gets at most one, the oldest due, and the row is leased to
 * it: due again only after the ack window and a growing wait (domain/delivery-timing.ts), so a
 * crash between the send and the ack hands it out again later, never twice at once. The
 * assistant's own sent-keys file then acks it without sending it again.
 *
 * A row older than 7 days is never handed out; the expiry job (`dropExpiredNotifications`) drops
 * it and counts it by `drop_reason`, but never a row leased right now. Everything is held once
 * the Vietnam day's proactive sends reach the daily cap: sends acknowledged today plus rows leased
 * right now; the first time a day reaches it the owner is alerted, once. A row whose customer has
 * no recipient (domain: identity's `zaloRecipientOf`) is dropped as `no_recipient`, counted, and
 * the next row is tried. A guest never has a row: `enqueue` refused it.
 *
 * An ack of `sent` always wins: it records the send and clears a drop made meanwhile. An ack of a
 * "link ready" row tells linking the link was handed over (Story 6.5).
 */
import { instantFromMs, toMs, vnDateOf, vnDayStart, type Clock, type Instant } from "@cashback/core";
import { and, asc, count, eq, gt, gte, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import type { AlertPort } from "../../platform/ports/alert.port";
import { zaloRecipientOf } from "../identity/index";
import { markLinkDelivered, requestOfDeliveredKey } from "../linking/index";
import { ACK_WINDOW_MS, dueAgainAfterMs, NOTIFICATION_MAX_AGE_MS } from "./domain/delivery-timing";
import { outbox, outboxCapDays, OUTBOX_DROP_REASONS, type OutboxDropReason } from "./schema";

export const DAILY_CAP_ALERT = { kind: "notification_daily_cap", severity: "high" } as const;
export const UNDELIVERABLE_ALERT = { kind: "notification_undeliverable", severity: "warning" } as const;

/** Rows without a recipient skipped in one handout before it gives up until the next pull. */
const MAX_SKIPPED = 20;

export interface HandoutOptions {
  /** The hard cap on proactive sends per Vietnam day (config, default 150). */
  readonly dailyCap: number;
  readonly alerts: AlertPort;
}

export interface HandedOutNotification {
  readonly id: number;
  readonly dedupKey: string;
  readonly customerId: string;
  readonly zaloUserId: string;
  readonly messageKey: string;
  readonly params: Readonly<Record<string, string | number>>;
}

export type Handout =
  | { readonly kind: "row"; readonly row: HandedOutNotification; readonly noRecipient: number }
  | { readonly kind: "none" | "capped"; readonly noRecipient: number };

const leaseOpenSince = (now: Instant): Instant => instantFromMs(toMs(now) - ACK_WINDOW_MS);
const notLeased = (now: Instant) => or(isNull(outbox.handedOutAt), lte(outbox.handedOutAt, leaseOpenSince(now)));

/** Drops the unsent rows older than 7 days that are not leased right now; the expiry job's command. */
export function dropExpiredNotifications(db: LedgerDb, clock: Clock): number {
  const now = clock.now();
  const before = instantFromMs(toMs(now) - NOTIFICATION_MAX_AGE_MS);
  return db
    .update(outbox)
    .set({ dueAt: null, droppedAt: now, dropReason: "expired" })
    .where(and(isNull(outbox.sentAt), isNull(outbox.droppedAt), isNotNull(outbox.dueAt), lt(outbox.createdAt, before), notLeased(now)))
    .run().changes;
}

/** Proactive sends of the Vietnam day of `now`: acknowledged today, plus rows leased right now. */
export function sendsToday(db: LedgerDb, now: Instant): number {
  const dayStart = vnDayStart(vnDateOf(now));
  const sent = and(eq(outbox.origin, "EVENT"), gte(outbox.sentAt, dayStart));
  const leased = and(isNull(outbox.sentAt), gt(outbox.handedOutAt, leaseOpenSince(now)));
  return db.select({ n: count() }).from(outbox).where(or(sent, leased)).get()?.n ?? 0;
}

function noteCapReached(db: LedgerDb, now: Instant, alerts: AlertPort): void {
  const added = db.insert(outboxCapDays).values({ day: vnDateOf(now), reachedAt: now }).onConflictDoNothing().run().changes;
  if (added === 1) alerts.alert(DAILY_CAP_ALERT.kind, DAILY_CAP_ALERT.severity);
}

const dropRow = (db: LedgerDb, id: number, now: Instant, reason: OutboxDropReason): void => {
  db.update(outbox).set({ dueAt: null, droppedAt: now, dropReason: reason }).where(eq(outbox.id, id)).run();
};

/** The oldest due row younger than 7 days (the `outbox_handout` index). */
const nextDue = (db: LedgerDb, now: Instant) =>
  db
    .select()
    .from(outbox)
    .where(and(isNull(outbox.sentAt), isNull(outbox.droppedAt), isNotNull(outbox.dueAt), lte(outbox.dueAt, now), gte(outbox.createdAt, instantFromMs(toMs(now) - NOTIFICATION_MAX_AGE_MS))))
    .orderBy(asc(outbox.dueAt), asc(outbox.id))
    .limit(1)
    .get();

/** The next due row, leased to the assistant; call inside `tx`. */
export function handOutNext(db: LedgerDb, clock: Clock, options: HandoutOptions): Handout {
  if (!(Number.isInteger(options.dailyCap) && options.dailyCap > 0)) throw new RangeError("the daily cap must be a whole number above 0");
  const now = clock.now();
  let noRecipient = 0;
  for (let skipped = 0; skipped <= MAX_SKIPPED; skipped++) {
    const row = nextDue(db, now);
    if (row === undefined) return { kind: "none", noRecipient };
    if (sendsToday(db, now) >= options.dailyCap) {
      noteCapReached(db, now, options.alerts);
      return { kind: "capped", noRecipient };
    }
    const recipient = zaloRecipientOf(db, row.customerId);
    if (recipient === null) {
      dropRow(db, row.id, now, "no_recipient");
      noRecipient++;
      continue;
    }
    const handouts = row.attempts + 1;
    db.update(outbox)
      .set({ attempts: handouts, handedOutAt: now, dueAt: instantFromMs(toMs(now) + dueAgainAfterMs(handouts)) })
      .where(eq(outbox.id, row.id))
      .run();
    const params = JSON.parse(row.params) as Record<string, string | number>;
    return { kind: "row", noRecipient, row: { id: row.id, dedupKey: row.dedupKey, customerId: recipient.customerId, zaloUserId: recipient.zaloUserId, messageKey: row.messageKey, params } };
  }
  return { kind: "none", noRecipient };
}

export type AckOutcome = "sent" | "already_sent" | "dropped" | "not_found";

/**
 * The assistant's acknowledgement of one row; call inside `tx`. `sent` records the send, also for
 * a row whose lease ran out or that was dropped meanwhile (it was sent, so it is never due again
 * and the drop is cleared); `undeliverable` (the assistant has no complete text for it) drops the
 * row and warns the owner. A second ack is answered `already_sent` and changes nothing.
 */
export function acknowledgeNotification(db: LedgerDb, clock: Clock, id: number, result: "sent" | "undeliverable", alerts: AlertPort): AckOutcome {
  const row = db.select({ dedupKey: outbox.dedupKey, sentAt: outbox.sentAt, droppedAt: outbox.droppedAt }).from(outbox).where(eq(outbox.id, id)).get();
  if (row === undefined) return "not_found";
  if (row.sentAt !== null) return "already_sent";
  const now = clock.now();
  if (result === "sent") {
    db.update(outbox).set({ sentAt: now, dueAt: null, droppedAt: null, dropReason: null }).where(and(eq(outbox.id, id), isNull(outbox.sentAt))).run();
    const requestId = requestOfDeliveredKey(row.dedupKey);
    if (requestId !== null) markLinkDelivered(db, requestId, now);
    return "sent";
  }
  if (row.droppedAt === null) {
    dropRow(db, id, now, "undeliverable");
    alerts.alert(UNDELIVERABLE_ALERT.kind, UNDELIVERABLE_ALERT.severity);
  }
  return "dropped";
}

/**
 * What this row would tell was handed over another way first (a chat reply confirmed after its
 * claim lapsed, Story 6.5): it is dropped as `superseded` unless it is already sent or leased right
 * now (the assistant may be sending it). Call inside `tx`; true when it was withdrawn.
 */
export function withdrawPendingNotification(db: LedgerDb, dedupKey: string, now: Instant): boolean {
  return (
    db
      .update(outbox)
      .set({ dueAt: null, droppedAt: now, dropReason: "superseded" })
      .where(and(eq(outbox.dedupKey, dedupKey), isNull(outbox.sentAt), isNull(outbox.droppedAt), isNull(outbox.silencedAt), notLeased(now)))
      .run().changes === 1
  );
}

/** Unsent rows dropped, per reason (AC5: dropped and counted). */
export function droppedNotifications(db: LedgerDb): Record<OutboxDropReason, number> {
  const rows = db.select({ reason: outbox.dropReason, n: count() }).from(outbox).where(isNotNull(outbox.dropReason)).groupBy(outbox.dropReason).all();
  const counts = Object.fromEntries(OUTBOX_DROP_REASONS.map((r) => [r, 0])) as Record<OutboxDropReason, number>;
  for (const row of rows) if (row.reason !== null) counts[row.reason] = row.n;
  return counts;
}

/** True when this ledger was made by the cutover import from production data (it holds seeded keys). */
export function holdsCutoverSeeds(db: LedgerDb): boolean {
  return db.select({ one: sql<number>`1` }).from(outbox).where(eq(outbox.origin, "CUTOVER_SEED")).limit(1).get() !== undefined;
}
