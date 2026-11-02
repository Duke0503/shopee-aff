/**
 * Accepting a friend request someone sent the account, as the live assistant did (friends.js
 * `onFriendRequest`): after a human pause of 10 to 40 s, through the pacer like every send. The
 * server is asked first (`/internal/assistant/friend-checks`): the guest account (HOUSE, D5) and a
 * disabled customer are never accepted. Every acceptance goes through here, also one found when
 * the assistant itself wanted to ask the person (zca-zalo.adapter.ts `addFriend`).
 *
 * The acceptance takes a slot of the same daily friend limit (friend-request.ts); over the day's
 * limit it waits for the next Vietnam day. The person is remembered as accepted only once the
 * acceptance went through: a check the server could not answer or an acceptance Zalo refused is
 * tried again after 1, 5 and 15 minutes, then left for the next start, when the requests still
 * waiting in Zalo are read again (`rescan`) and handled the same way.
 */
import { toMs, type Clock } from "@cashback/core";

import type { FriendRequestLimiter } from "./friend-request";
import type { InternalApi } from "./internal-api.adapter";
import type { Pacer, Sleep } from "./pacer";
import type { ZaloSession } from "./zalo.port";

/** The live assistant's pause before accepting: 10 to 40 s. */
export const ACCEPT_PAUSE_MIN_MS = 10_000;
export const ACCEPT_PAUSE_MAX_MS = 40_000;
/** The waits before each retry of a failed check or acceptance; then it is left for the next start. */
export const ACCEPT_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;

export type FriendAcceptOutcome = "accepted" | "refused_by_server" | "already_accepted" | "in_progress" | "gave_up" | "stopped";

export interface FriendAcceptDeps {
  readonly limiter: FriendRequestLimiter;
  readonly pacer: Pacer;
  readonly zalo: Pick<ZaloSession, "acceptFriend" | "pendingFriendRequests">;
  readonly api: Pick<InternalApi, "friendCheck">;
  readonly clock: Clock;
  readonly sleep: Sleep;
  readonly random: () => number;
  readonly signal?: AbortSignal;
}

export interface FriendAccepter {
  accept(userId: string): Promise<FriendAcceptOutcome>;
  /** Handles every request still waiting in Zalo, one after another; called at start. */
  rescan(): Promise<readonly FriendAcceptOutcome[]>;
}

type Attempt = "accepted" | "refused_by_server" | "already_accepted" | "failed" | "stopped";

async function attempt(deps: FriendAcceptDeps, userId: string): Promise<Attempt> {
  const accept = await deps.api
    .friendCheck(userId)
    .then((answer) => answer.accept)
    .catch(() => null);
  if (accept === null) return "failed";
  if (!accept) return "refused_by_server";
  await deps.sleep(ACCEPT_PAUSE_MIN_MS + Math.floor(deps.random() * (ACCEPT_PAUSE_MAX_MS - ACCEPT_PAUSE_MIN_MS)), deps.signal);
  for (;;) {
    if (deps.signal?.aborted) return "stopped";
    const admission = deps.limiter.admitAccept(userId);
    if (admission.kind === "refused") return "already_accepted";
    if (admission.kind === "admitted") break;
    await deps.sleep(toMs(admission.until) - toMs(deps.clock.now()), deps.signal);
  }
  const sent = await deps.pacer.send(() => deps.zalo.acceptFriend(userId)).then(
    () => true,
    () => false,
  );
  if (!sent) return "failed";
  deps.limiter.noteAccepted(userId);
  return "accepted";
}

export function friendAccepter(deps: FriendAcceptDeps): FriendAccepter {
  const inFlight = new Set<string>();
  const accept = async (userId: string): Promise<FriendAcceptOutcome> => {
    if (deps.limiter.isAccepted(userId)) return "already_accepted";
    if (inFlight.has(userId)) return "in_progress";
    inFlight.add(userId);
    try {
      for (let tries = 0; ; tries += 1) {
        const outcome = await attempt(deps, userId);
        if (outcome !== "failed") return outcome;
        const wait = ACCEPT_RETRY_DELAYS_MS[tries];
        if (wait === undefined) return "gave_up";
        await deps.sleep(wait, deps.signal);
        if (deps.signal?.aborted) return "stopped";
      }
    } finally {
      inFlight.delete(userId);
    }
  };
  return {
    accept,
    rescan: async () => {
      const outcomes: FriendAcceptOutcome[] = [];
      for (const userId of await deps.zalo.pendingFriendRequests()) {
        if (deps.signal?.aborted) break;
        outcomes.push(await accept(userId));
      }
      return outcomes;
    },
  };
}
