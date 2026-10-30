import { describe, expect, it } from "vitest";
import { decideFriendRequest, type FriendRequestInput } from "../src/friend-requests";

const input = (over: Partial<FriendRequestInput> = {}): FriendRequestInput => ({
  hasDirectMessage: true,
  nowMs: 10_000,
  minGapMs: 5000,
  maxPerRun: 5,
  ...over,
});

describe("decideFriendRequest", () => {
  it("sends to someone who messaged first, with no prior request", () => {
    expect(decideFriendRequest({ lastRequestAtMs: null, sentCount: 0 }, input()).kind).toBe("send");
  });

  it("never sends to someone who did not message first", () => {
    const decision = decideFriendRequest({ lastRequestAtMs: null, sentCount: 0 }, input({ hasDirectMessage: false }));
    expect(decision).toEqual({ kind: "skip", reason: "only to people who messaged first" });
  });

  it("waits the minimum gap between requests", () => {
    const decision = decideFriendRequest({ lastRequestAtMs: 8000, sentCount: 1 }, input());
    expect(decision).toEqual({ kind: "skip", reason: "too soon after the last request" });
  });

  it("sends once the gap has passed", () => {
    expect(decideFriendRequest({ lastRequestAtMs: 1000, sentCount: 1 }, input()).kind).toBe("send");
  });

  it("stops at the cap", () => {
    const decision = decideFriendRequest({ lastRequestAtMs: 0, sentCount: 5 }, input());
    expect(decision).toEqual({ kind: "skip", reason: "request cap reached" });
  });
});
