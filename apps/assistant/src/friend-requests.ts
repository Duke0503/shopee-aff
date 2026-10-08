/**
 * Friend requests are rate-limited and only ever sent to someone who has
 * messaged us first. Ports `friends.js`. Zalo limits how often an account may
 * add strangers, and an over-eager bot gets the account restricted.
 */
export interface FriendRequestState {
  lastRequestAtMs: number | null;
  sentCount: number;
}

export interface FriendRequestInput {
  hasDirectMessage: boolean;
  nowMs: number;
  minGapMs: number;
  maxPerRun: number;
}

export type FriendDecision = { kind: "send" } | { kind: "skip"; reason: string };

export function decideFriendRequest(
  state: FriendRequestState,
  input: FriendRequestInput,
): FriendDecision {
  if (!input.hasDirectMessage) {
    return { kind: "skip", reason: "only to people who messaged first" };
  }
  if (state.lastRequestAtMs !== null && input.nowMs - state.lastRequestAtMs < input.minGapMs) {
    return { kind: "skip", reason: "too soon after the last request" };
  }
  if (state.sentCount >= input.maxPerRun) {
    return { kind: "skip", reason: "request cap reached" };
  }
  return { kind: "send" };
}
