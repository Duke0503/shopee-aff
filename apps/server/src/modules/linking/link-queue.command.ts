/**
 * The Shopee link queue's hold and pause (AD-14, AD-27, D8; Story 5.5), kept in
 * `link_queue_state`. A hold (captcha, page error) ends by itself at `held_until`; a pause (the
 * login was lost) ends only when the owner resumes the queue by command, after signing the
 * affiliate browser in again. While either lasts, the link job hands no Shopee job to the bridge.
 * Resuming clears both, audits who did it, and the queue goes on in its usual order, so the oldest
 * request of the highest priority is served first. Each function runs inside the caller's `tx`.
 */
import { toMs, type Instant } from "@cashback/core";
import { eq } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import type { CommandAudit } from "../../platform/ports/audit.port";
import type { QueueHoldReason, QueuePauseReason } from "./domain/link-failure";
import { linkQueueState } from "./schema";

const SHOPEE = "shopee" as const;

export type QueueGate = "open" | "held" | "paused";

export interface LinkQueueState {
  readonly pausedReason: QueuePauseReason | null;
  readonly pausedAt: string | null;
  readonly heldReason: QueueHoldReason | null;
  readonly heldUntil: string | null;
  /** The request whose submission last ended in a page error (Story 5.5 review item 1). */
  readonly lastPageErrorRequest: string | null;
}

const OPEN: LinkQueueState = { pausedReason: null, pausedAt: null, heldReason: null, heldUntil: null, lastPageErrorRequest: null };
const NOT_HELD = { pausedReason: null, pausedAt: null, heldReason: null, heldUntil: null } as const;

export function shopeeQueueState(db: LedgerDb): LinkQueueState {
  const row = db.select().from(linkQueueState).where(eq(linkQueueState.queue, SHOPEE)).get();
  return row === undefined ? OPEN : { pausedReason: row.pausedReason, pausedAt: row.pausedAt, heldReason: row.heldReason, heldUntil: row.heldUntil, lastPageErrorRequest: row.lastPageErrorRequest };
}

/** Whether a Shopee job may be handed to the bridge now. */
export function shopeeQueueGate(db: LedgerDb, now: Instant): QueueGate {
  const state = shopeeQueueState(db);
  if (state.pausedAt !== null) return "paused";
  if (state.heldUntil !== null && toMs(state.heldUntil as Instant) > toMs(now)) return "held";
  return "open";
}

function write(db: LedgerDb, values: Partial<LinkQueueState>): void {
  db.insert(linkQueueState)
    .values({ queue: SHOPEE, ...OPEN, ...values })
    .onConflictDoUpdate({ target: linkQueueState.queue, set: values })
    .run();
}

/** Holds the queue until `until`; a longer hold already in place is kept. */
export function holdShopeeQueue(db: LedgerDb, reason: QueueHoldReason, until: Instant): void {
  const current = shopeeQueueState(db).heldUntil;
  if (current !== null && toMs(current as Instant) >= toMs(until)) return;
  write(db, { heldReason: reason, heldUntil: until });
}

/** Remembers which request's submission last ended in a page error; null after any other answer. */
export function notePageError(db: LedgerDb, requestId: string | null): void {
  if (shopeeQueueState(db).lastPageErrorRequest === requestId) return;
  write(db, { lastPageErrorRequest: requestId });
}

/** Pauses the queue; false when it was paused already. */
export function pauseShopeeQueue(db: LedgerDb, reason: QueuePauseReason, at: Instant): boolean {
  if (shopeeQueueState(db).pausedAt !== null) return false;
  write(db, { pausedReason: reason, pausedAt: at });
  return true;
}

export interface QueueResumed {
  readonly resumed: boolean;
  /** Why it was paused, or null when it was not. */
  readonly pausedReason: QueuePauseReason | null;
}

/**
 * The owner's resume (Story 5.5 AC4): clears the pause and any hold still running. A queue the gate
 * already finds open (an expired hold included, review item 7) is left as it is and not audited.
 */
export function resumeShopeeQueue(db: LedgerDb, by: CommandAudit, now: Instant): QueueResumed {
  if (shopeeQueueGate(db, now) === "open") return { resumed: false, pausedReason: null };
  const state = shopeeQueueState(db);
  write(db, NOT_HELD);
  by.audit.record({ actor: by.actor, event: "linking.link_queue.resumed", entityId: SHOPEE, payload: { pausedReason: state.pausedReason, heldReason: state.heldReason } });
  return { resumed: true, pausedReason: state.pausedReason };
}
