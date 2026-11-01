import { join } from "node:path";
import { addVnDays, parseInstant, systemClock, toMs, vnDateOf, vnDayStart } from "@cashback/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeZaloSession } from "../src/fake-zalo.adapter";
import { FRIEND_REQUESTS_PER_VN_DAY, friendRequestLimiter, requestFriend, type FriendRequestDeps, type FriendStateStore } from "../src/friend-request";
import { FRIEND_STATE_FILE, fileFriendStateStore, type StateFiles } from "../src/friend-state-file.adapter";
import { messageText } from "../src/messages";
import { createPacer, timerSleep } from "../src/pacer";

// 10:00 in Vietnam on 2026-11-01; the next Vietnam day starts at 2026-11-01T17:00:00.000Z.
const START = "2026-11-01T03:00:00.000Z";
const DELAY = { minMs: 6_000, maxMs: 12_000 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(toMs(parseInstant(START)));
});
afterEach(() => {
  vi.useRealTimers();
});

function memoryFiles(): StateFiles & { files: Map<string, string>; writes: string[] } {
  const files = new Map<string, string>();
  const writes: string[] = [];
  return {
    files,
    writes,
    readFile: (path) => files.get(path) ?? null,
    writeFile: (path, text) => {
      writes.push(path);
      files.set(path, text);
    },
    rename: (from, to) => {
      files.set(to, files.get(from)!);
      files.delete(from);
    },
  };
}

function setup(perDay = FRIEND_REQUESTS_PER_VN_DAY, store?: FriendStateStore) {
  const zalo = fakeZaloSession(systemClock);
  const limiter = friendRequestLimiter(systemClock, perDay, store);
  const deps: FriendRequestDeps = { limiter, pacer: createPacer({ clock: systemClock, sleep: timerSleep, delay: DELAY, random: () => 0 }), zalo, clock: systemClock, sleep: timerSleep, greeting: messageText("friend_request_greeting") };
  return { zalo, limiter, deps };
}

describe("Story 6.1: friend requests", () => {
  it("AC2: of 31 friend requests due in one Vietnam day, 30 are sent that day and the 31st waits for the next day", async () => {
    const { zalo, limiter, deps } = setup();
    const people = Array.from({ length: 31 }, (_, i) => `uid${i}`);
    for (const uid of people) limiter.noteWroteFirst(uid);
    const outcomes = people.map((uid) => requestFriend(deps, uid));

    await vi.advanceTimersByTimeAsync(31 * DELAY.minMs);
    expect(zalo.friendRequests).toHaveLength(30);
    expect(new Set(zalo.friendRequests.map((r) => vnDateOf(r.at)))).toEqual(new Set([vnDateOf(parseInstant(START))]));

    const nextDay = vnDayStart(addVnDays(vnDateOf(parseInstant(START)), 1));
    await vi.advanceTimersByTimeAsync(toMs(nextDay) - toMs(systemClock.now()) - 1);
    expect(zalo.friendRequests).toHaveLength(30);

    await vi.advanceTimersByTimeAsync(1);
    expect(await Promise.all(outcomes)).toEqual(Array(31).fill("sent"));
    expect(zalo.friendRequests).toHaveLength(31);
    const last = zalo.friendRequests[30]!;
    expect(last.userId).toBe("uid30");
    expect(toMs(last.at)).toBeGreaterThanOrEqual(toMs(nextDay));
    expect(last.greeting).toBe(messageText("friend_request_greeting"));
  });

  it("AC2: a friend request to someone who never wrote first is refused and nothing reaches Zalo", async () => {
    const { zalo, limiter, deps } = setup();
    expect(await requestFriend(deps, "stranger")).toBe("never_wrote_first");
    expect(limiter.admit("stranger")).toEqual({ kind: "refused", reason: "never_wrote_first" });
    expect(zalo.friendRequests).toHaveLength(0);
  });

  it("asks each person once, and a lower configured limit is honoured but 31 is refused", async () => {
    const { zalo, limiter, deps } = setup(1);
    limiter.noteWroteFirst("a");
    limiter.noteWroteFirst("b");
    expect(await requestFriend(deps, "a")).toBe("sent");
    expect(await requestFriend(deps, "a")).toBe("already_requested");
    expect(limiter.admit("b")).toMatchObject({ kind: "wait" });
    expect(zalo.friendRequests).toHaveLength(1);
    expect(() => friendRequestLimiter(systemClock, 31)).toThrow(RangeError);
  });

  it("a request waiting for the next day ends when the assistant stops", async () => {
    const { limiter, deps } = setup(0);
    const stopping = new AbortController();
    limiter.noteWroteFirst("a");
    const outcome = requestFriend({ ...deps, signal: stopping.signal }, "a");
    await vi.advanceTimersByTimeAsync(1_000);
    stopping.abort();
    expect(await outcome).toBe("stopped");
  });

  it("AC2: a restart in the same Vietnam day keeps the count; the 31st still waits for the next day", async () => {
    const files = memoryFiles();
    const warnings: string[] = [];
    const store = () => fileFriendStateStore("/assistant-data", files, (event) => warnings.push(event));

    const before = setup(FRIEND_REQUESTS_PER_VN_DAY, store());
    expect(warnings).toEqual(["assistant.friend_state.missing"]);
    const first = Array.from({ length: 20 }, (_, i) => `uid${i}`);
    for (const uid of first) before.limiter.noteWroteFirst(uid);
    await vi.advanceTimersByTimeAsync(0);
    const sentBefore = first.map((uid) => requestFriend(before.deps, uid));
    await vi.advanceTimersByTimeAsync(20 * DELAY.minMs);
    expect(await Promise.all(sentBefore)).toEqual(Array(20).fill("sent"));
    expect(files.writes.every((path) => path.endsWith(`${FRIEND_STATE_FILE}.tmp`))).toBe(true);
    expect([...files.files.keys()].map((path) => path.replaceAll("\\", "/"))).toEqual([`/assistant-data/${FRIEND_STATE_FILE}`]);

    // The assistant restarts: a new limiter reads the same file.
    const after = setup(FRIEND_REQUESTS_PER_VN_DAY, store());
    const rest = Array.from({ length: 11 }, (_, i) => `uid${20 + i}`);
    for (const uid of [...first, ...rest]) after.limiter.noteWroteFirst(uid);
    expect(after.limiter.admit("uid0")).toEqual({ kind: "refused", reason: "already_requested" });
    const outcomes = rest.map((uid) => requestFriend(after.deps, uid));
    await vi.advanceTimersByTimeAsync(11 * DELAY.minMs);
    expect(after.zalo.friendRequests).toHaveLength(10);

    const nextDay = vnDayStart(addVnDays(vnDateOf(parseInstant(START)), 1));
    await vi.advanceTimersByTimeAsync(toMs(nextDay) - toMs(systemClock.now()));
    expect(await Promise.all(outcomes)).toEqual(Array(11).fill("sent"));
    expect(after.zalo.friendRequests[10]!.userId).toBe("uid30");
    expect(toMs(after.zalo.friendRequests[10]!.at)).toBeGreaterThanOrEqual(toMs(nextDay));
  });

  it("a corrupt state file starts the count again with a warning, and a failed save refuses the request", async () => {
    const files = memoryFiles();
    files.files.set(join("/assistant-data", FRIEND_STATE_FILE), "{not json");
    const warnings: string[] = [];
    const { limiter } = setup(FRIEND_REQUESTS_PER_VN_DAY, fileFriendStateStore("/assistant-data", files, (event) => warnings.push(event)));
    expect(warnings).toEqual(["assistant.friend_state.unreadable"]);
    limiter.noteWroteFirst("a");
    expect(limiter.admit("a")).toEqual({ kind: "admitted" });

    const broken = friendRequestLimiter(systemClock, 30, { load: () => null, save: () => { throw new Error("disk full"); } });
    broken.noteWroteFirst("b");
    expect(() => broken.admit("b")).toThrow("disk full");
    broken.noteWroteFirst("b");
    expect(() => broken.admit("b")).toThrow("disk full");
  });
});
