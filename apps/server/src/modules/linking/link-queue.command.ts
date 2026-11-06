/**
 * The Shopee link queue's hold and pause (AD-14, AD-27, D8; Story 5.5), kept in
 * `link_queue_state`. A hold (captcha, page error) ends by itself at `held_until`; a pause (the
 * login was lost) ends only when the owner resumes the queue by command, after signing the
 * affiliate browser in again. While either lasts, the link job hands no Shopee job to the bridge.
 * Resuming clears both, audits who did it, and the queue goes on in its usual order, so the oldest
 * request of the highest priority is served first. Each function runs inside the caller's `tx`.
 * When the bridge sees a Shopee tab leave the verification page, a captcha hold ends at once (D68);
 * that never lifts a pause or a page error hold.
 *
 * "Stopped" (D65) is what the customer and the owner are told about: a captcha hold or a pause. A
 * page error hold is not, because it lasts one minute.
 *
 * `last_captcha_at` and `captcha_cleared_at` outlive the hold, so a waiting captcha alert can be judged
 * at send time (D69); a later hold of any reason leaves them alone.
 */
import { toMs, type Instant } from "@cashback/core";
import { and, asc, eq, sql } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import type { CommandAudit } from "../../platform/ports/audit.port";
import type { QueueHoldReason, QueuePauseReason } from "./domain/link-failure";
import { linkQueueState, linkRequests } from "./schema";

const SHOPEE = "shopee" as const;

export type QueueGate = "open" | "held" | "paused";

export interface LinkQueueState {
  readonly pausedReason: QueuePauseReason | null;
  readonly pausedAt: string | null;
  readonly heldReason: QueueHoldReason | null;
  readonly heldUntil: string | null;
  /** The request whose submission last ended in a page error (Story 5.5 review item 1). */
  readonly lastPageErrorRequest: string | null;
  /** When the latest captcha was met (D69). */
  readonly lastCaptchaAt: string | null;
  /** When a captcha was last cleared (D69). */
  readonly captchaClearedAt: string | null;
}

const OPEN: LinkQueueState = { pausedReason: null, pausedAt: null, heldReason: null, heldUntil: null, lastPageErrorRequest: null, lastCaptchaAt: null, captchaClearedAt: null };
const NOT_HELD = { pausedReason: null, pausedAt: null, heldReason: null, heldUntil: null } as const;

export function shopeeQueueState(db: LedgerDb): LinkQueueState {
  const row = db.select().from(linkQueueState).where(eq(linkQueueState.queue, SHOPEE)).get();
  return row === undefined ? OPEN : { pausedReason: row.pausedReason, pausedAt: row.pausedAt, heldReason: row.heldReason, heldUntil: row.heldUntil, lastPageErrorRequest: row.lastPageErrorRequest, lastCaptchaAt: row.lastCaptchaAt, captchaClearedAt: row.captchaClearedAt };
}

/** Whether a Shopee job may be handed to the bridge now. */
export function shopeeQueueGate(db: LedgerDb, now: Instant): QueueGate {
  const state = shopeeQueueState(db);
  if (state.pausedAt !== null) return "paused";
  if (state.heldUntil !== null && toMs(state.heldUntil as Instant) > toMs(now)) return "held";
  return "open";
}

export type QueueStopReason = "captcha" | "login_lost";

/** Why the Shopee queue is stopped now, or null when it is open or only held for a page error. */
export function shopeeQueueStopReason(db: LedgerDb, now: Instant): QueueStopReason | null {
  const gate = shopeeQueueGate(db, now);
  if (gate === "paused") return "login_lost";
  return gate === "held" && shopeeQueueState(db).heldReason !== "page_error" ? "captcha" : null;
}

/** The requests the Shopee queue would serve, oldest first: the ones a stopped queue keeps waiting. */
export function queuedShopeeRequests(db: LedgerDb): string[] {
  return db
    .select({ requestId: linkRequests.requestId })
    .from(linkRequests)
    .where(and(eq(linkRequests.status, "QUEUED"), eq(linkRequests.origin, "REQUEST"), sql`coalesce(${linkRequests.network}, 'shopee') = 'shopee'`))
    .orderBy(asc(linkRequests.createdAt), asc(linkRequests.requestId))
    .all()
    .map((row) => row.requestId);
}

function write(db: LedgerDb, values: Partial<LinkQueueState>): void {
  db.insert(linkQueueState)
    .values({ queue: SHOPEE, ...OPEN, ...values })
    .onConflictDoUpdate({ target: linkQueueState.queue, set: values })
    .run();
}

/** Holds the queue until `until`; a longer hold already in place is kept. A captcha is recorded at `at` either way (D69). */
export function holdShopeeQueue(db: LedgerDb, reason: "captcha", until: Instant, at: Instant): void;
export function holdShopeeQueue(db: LedgerDb, reason: "page_error", until: Instant): void;
export function holdShopeeQueue(db: LedgerDb, reason: QueueHoldReason, until: Instant, at?: Instant): void {
  if (at !== undefined) write(db, { lastCaptchaAt: at });
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
  const liftsCaptcha = state.heldReason === "captcha" && state.heldUntil !== null && toMs(state.heldUntil as Instant) > toMs(now);
  write(db, liftsCaptcha ? { ...NOT_HELD, captchaClearedAt: now } : NOT_HELD);
  by.audit.record({ actor: by.actor, event: "linking.link_queue.resumed", entityId: SHOPEE, payload: { pausedReason: state.pausedReason, heldReason: state.heldReason } });
  return { resumed: true, pausedReason: state.pausedReason };
}

/**
 * A Shopee tab left the verification page (D68): ends a captcha hold still running, audited. A pause,
 * a page error hold or an expired hold is left as it is. True when a hold ended. Whichever it is, a
 * captcha on record counts as cleared from now: an owner slower than the hold still cleared it (D69).
 */
export function clearCaptchaHold(db: LedgerDb, by: CommandAudit, now: Instant): boolean {
  const { heldReason, heldUntil, lastCaptchaAt } = shopeeQueueState(db);
  if (heldReason !== "captcha" || heldUntil === null || toMs(heldUntil as Instant) <= toMs(now)) {
    if (lastCaptchaAt !== null) write(db, { captchaClearedAt: now });
    return false;
  }
  write(db, { heldReason: null, heldUntil: null, captchaClearedAt: now });
  by.audit.record({ actor: by.actor, event: "linking.link_queue.captcha_cleared", entityId: SHOPEE, payload: { heldUntil } });
  return true;
}
