/**
 * Friend requests, sparingly (AD-15, D9). A customer who is the account's friend gets notices in
 * the main inbox, but a personal account adding strangers in bulk gets locked. So a request goes
 * only to someone who wrote to the assistant privately first, at most once per person, at most
 * `perDay` (30) per Vietnam calendar day, and through the pacer like every other send. A request
 * over the day's limit waits for the next Vietnam day; it is never dropped and never sent early.
 *
 * A slot is taken when the request is admitted, before the pacer sends it, so requests asked for
 * at the same moment can never pass the limit together. The slot is saved through the injected
 * store before it is used, so a restart in the same Vietnam day keeps the count (D9); the file
 * store is friend-state-file.adapter.ts.
 */
import { addVnDays, toMs, vnDateOf, vnDayStart, type Clock, type Instant, type VnDate } from "@cashback/core";

import type { Pacer, Sleep } from "./pacer";
import type { ZaloSession } from "./zalo.port";

/** The ceiling of AD-15; configuration may lower it, never raise it. */
export const FRIEND_REQUESTS_PER_VN_DAY = 30;

export type FriendAdmission =
  | { readonly kind: "admitted" }
  | { readonly kind: "refused"; readonly reason: "never_wrote_first" | "already_requested" }
  | { readonly kind: "wait"; readonly until: Instant };

export interface FriendRequestLimiter {
  /** A private message from this person arrived. */
  noteWroteFirst(userId: string): void;
  /** Decides and, when admitted, takes today's slot and marks the person as asked. */
  admit(userId: string): FriendAdmission;
}

/** What survives a restart (AD-15 allows the assistant small local files): the day's count and everyone asked. */
export interface FriendRequestState {
  readonly day: VnDate;
  readonly count: number;
  readonly requested: readonly string[];
}

/** Synchronous so a slot is saved before it is used; a failing `save` refuses the request. */
export interface FriendStateStore {
  /** Null when there is no saved state (a missing or unreadable file). */
  load(): FriendRequestState | null;
  save(state: FriendRequestState): void;
}

export const memoryFriendStateStore = (initial: FriendRequestState | null = null): FriendStateStore & { saved: FriendRequestState | null } => {
  const store = {
    saved: initial,
    load: () => store.saved,
    save: (state: FriendRequestState) => {
      store.saved = state;
    },
  };
  return store;
};

export function friendRequestLimiter(clock: Clock, perDay: number = FRIEND_REQUESTS_PER_VN_DAY, store: FriendStateStore = memoryFriendStateStore()): FriendRequestLimiter {
  if (!Number.isInteger(perDay) || perDay < 0 || perDay > FRIEND_REQUESTS_PER_VN_DAY) throw new RangeError(`friend requests per day must be 0 to ${FRIEND_REQUESTS_PER_VN_DAY}`);
  const wroteFirst = new Set<string>();
  const saved = store.load();
  const asked = new Set<string>(saved?.requested ?? []);
  let day: VnDate | null = saved?.day ?? null;
  let count = saved?.count ?? 0;
  return {
    noteWroteFirst: (userId) => {
      wroteFirst.add(userId);
    },
    admit: (userId) => {
      if (!wroteFirst.has(userId)) return { kind: "refused", reason: "never_wrote_first" };
      if (asked.has(userId)) return { kind: "refused", reason: "already_requested" };
      const today = vnDateOf(clock.now());
      const used = day === today ? count : 0;
      if (used >= perDay) return { kind: "wait", until: vnDayStart(addVnDays(today, 1)) };
      store.save({ day: today, count: used + 1, requested: [...asked, userId] });
      day = today;
      count = used + 1;
      asked.add(userId);
      return { kind: "admitted" };
    },
  };
}

export type FriendRequestOutcome = "sent" | "never_wrote_first" | "already_requested" | "stopped";

export interface FriendRequestDeps {
  readonly limiter: FriendRequestLimiter;
  readonly pacer: Pacer;
  readonly zalo: ZaloSession;
  readonly clock: Clock;
  readonly sleep: Sleep;
  /** The greeting text, from the message file. */
  readonly greeting: string;
  readonly signal?: AbortSignal;
}

/** Asks one person; waits for the next Vietnam day when today's requests are used up. */
export async function requestFriend(deps: FriendRequestDeps, userId: string): Promise<FriendRequestOutcome> {
  for (;;) {
    if (deps.signal?.aborted) return "stopped";
    const admission = deps.limiter.admit(userId);
    if (admission.kind === "refused") return admission.reason;
    if (admission.kind === "admitted") {
      await deps.pacer.send(() => deps.zalo.addFriend(userId, deps.greeting));
      return "sent";
    }
    await deps.sleep(toMs(admission.until) - toMs(deps.clock.now()), deps.signal);
  }
}
