/**
 * Cutover parity with the live assistant (owner decisions): a friend request someone sent is
 * accepted after the server's check and a 10 to 40 s pause, within the daily friend limit; people
 * who join the main group are welcomed once ever, tagged; a session another login took is reported
 * to the server at once. Played by the fake session and a fake server: nothing reaches Zalo.
 */
import { ASSISTANT_FRIEND_CHECK_PATH, ASSISTANT_HEARTBEAT_PATH } from "@cashback/contracts";
import { parseInstant, systemClock, toMs } from "@cashback/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startAssistant } from "../src/assistant";
import { fakeZaloSession } from "../src/fake-zalo.adapter";
import { ACCEPT_PAUSE_MAX_MS, ACCEPT_PAUSE_MIN_MS, ACCEPT_RETRY_DELAYS_MS } from "../src/friend-accept";
import { memoryFriendStateStore, type FriendRequestState } from "../src/friend-request";
import { memoryWelcomeStore, welcomeMessage } from "../src/group-welcome";
import { internalApi } from "../src/internal-api.adapter";
import { messageText } from "../src/messages";
import { timerSleep } from "../src/pacer";
import { fileWelcomeStore, WELCOME_STATE_FILE } from "../src/welcome-state-file.adapter";
import { BASE, fakeServer, ok, TOKEN } from "./fake-server";

const START = "2026-11-01T03:00:00.000Z";
const MAIN_GROUP = "2813090100064697955";
const DEV_GROUP = "8786316503449470342";
const MINUTE = 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(toMs(parseInstant(START)));
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(options: { perDay?: number; welcomeGroupIds?: readonly string[]; random?: () => number; pending?: readonly string[]; friendState?: FriendRequestState | null } = {}) {
  const server = fakeServer();
  const zalo = fakeZaloSession(systemClock);
  zalo.pending.push(...(options.pending ?? []));
  const errors: string[] = [];
  const friendState = memoryFriendStateStore(options.friendState ?? null);
  const welcomeState = memoryWelcomeStore();
  const assistant = startAssistant({
    zalo,
    api: internalApi({ baseUrl: BASE, token: TOKEN, fetch: server.fetch }),
    clock: systemClock,
    sleep: timerSleep,
    sendDelay: { minMs: 6_000, maxMs: 12_000 },
    zaloGroupIds: [MAIN_GROUP, DEV_GROUP],
    friendRequestsPerDay: options.perDay ?? 30,
    friendState,
    welcomeGroupIds: options.welcomeGroupIds ?? [MAIN_GROUP],
    welcomeState,
    onError: (event) => void errors.push(event),
    random: options.random ?? (() => 0),
    notificationIdleMs: 10 * MINUTE,
    heartbeatIntervalMs: 10 * MINUTE,
  });
  return { server, zalo, errors, friendState, welcomeState, assistant };
}

describe("cutover: incoming friend requests are accepted like the live assistant", () => {
  it("accepts after the server's check and a pause of 10 to 40 s, through the pacer, taking a slot of the day", async () => {
    const { server, zalo, friendState, assistant } = setup({ random: () => 0.5 });
    zalo.emit({ kind: "friend_request", userId: "70001" });
    const pause = ACCEPT_PAUSE_MIN_MS + Math.floor(0.5 * (ACCEPT_PAUSE_MAX_MS - ACCEPT_PAUSE_MIN_MS));
    await vi.advanceTimersByTimeAsync(pause - 1);
    expect(zalo.accepted).toEqual([]);
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(zalo.accepted.map((a) => a.userId)).toEqual(["70001"]);
    expect(toMs(zalo.accepted[0]!.at) - toMs(parseInstant(START))).toBeGreaterThanOrEqual(pause);
    expect(server.callsTo(ASSISTANT_FRIEND_CHECK_PATH)).toEqual([{ zaloUserId: "70001" }]);
    expect(friendState.saved).toMatchObject({ count: 1, requested: [], accepted: ["70001"] });
    expect(zalo.friendRequests).toEqual([]);
    await assistant.stop();
  });

  it("never accepts someone the server refuses (the guest account or a disabled customer), nor when the server cannot be asked", async () => {
    const { server, zalo, friendState, assistant } = setup();
    server.routes[ASSISTANT_FRIEND_CHECK_PATH] = (body) => (body["zaloUserId"] === "70001" ? ok({ accept: false }) : { status: 503, body: {} });
    zalo.emit({ kind: "friend_request", userId: "70001" });
    zalo.emit({ kind: "friend_request", userId: "70002" });
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(zalo.accepted).toEqual([]);
    expect(friendState.saved).toBeNull();
    await assistant.stop();
  });

  it("respects the daily friend limit: over it the acceptance waits for the next Vietnam day; a person is handled once", async () => {
    const { zalo, assistant } = setup({ perDay: 1 });
    zalo.emit({ kind: "friend_request", userId: "70001" });
    zalo.emit({ kind: "friend_request", userId: "70002" });
    zalo.emit({ kind: "friend_request", userId: "70001" });
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(zalo.accepted.map((a) => a.userId)).toEqual(["70001"]);
    await vi.advanceTimersByTimeAsync(15 * 60 * MINUTE);
    expect(zalo.accepted.map((a) => a.userId)).toEqual(["70001", "70002"]);
    await assistant.stop();
  });
});

describe("review 5: an acceptance is recorded only once it went through, and is retried", () => {
  const RETRIES = ACCEPT_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);

  it("a check the server could not answer and an acceptance Zalo refused are retried with backoff; nothing is recorded before success", async () => {
    const { server, zalo, friendState, assistant } = setup();
    let checks = 0;
    server.routes[ASSISTANT_FRIEND_CHECK_PATH] = () => (++checks === 1 ? { status: 503, body: {} } : ok({ accept: true }));
    zalo.failAccepts = 1;
    zalo.emit({ kind: "friend_request", userId: "70001" });
    await vi.advanceTimersByTimeAsync(ACCEPT_RETRY_DELAYS_MS[0] + MINUTE);
    expect(zalo.accepted).toEqual([]);
    expect(friendState.saved?.accepted).toBeUndefined();
    await vi.advanceTimersByTimeAsync(ACCEPT_RETRY_DELAYS_MS[1] + MINUTE);
    expect(zalo.accepted.map((a) => a.userId)).toEqual(["70001"]);
    expect(friendState.saved?.accepted).toEqual(["70001"]);
    expect(checks).toBe(3);
    await assistant.stop();
  });

  it("the retries are bounded: after the last one the person stays unrecorded, for the next start", async () => {
    const { server, zalo, friendState, assistant } = setup();
    server.routes[ASSISTANT_FRIEND_CHECK_PATH] = () => ({ status: 503, body: {} });
    zalo.emit({ kind: "friend_request", userId: "70001" });
    await vi.advanceTimersByTimeAsync(RETRIES + 10 * MINUTE);
    expect(server.callsTo(ASSISTANT_FRIEND_CHECK_PATH)).toHaveLength(ACCEPT_RETRY_DELAYS_MS.length + 1);
    await vi.advanceTimersByTimeAsync(60 * MINUTE);
    expect(server.callsTo(ASSISTANT_FRIEND_CHECK_PATH)).toHaveLength(ACCEPT_RETRY_DELAYS_MS.length + 1);
    expect(friendState.saved).toBeNull();
    await assistant.stop();
  });

  it("at start the requests still waiting in Zalo are handled within the daily limit, skipping those already accepted", async () => {
    const day = { day: "2026-11-01", count: 0, requested: [], accepted: ["70009"] } as unknown as FriendRequestState;
    const { zalo, friendState, assistant } = setup({ perDay: 2, pending: ["70009", "70001", "70002", "70003"], friendState: day });
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(zalo.accepted.map((a) => a.userId)).toEqual(["70001", "70002"]);
    expect(friendState.saved).toMatchObject({ count: 2, accepted: ["70009", "70001", "70002"] });
    await assistant.stop();
  });

  it("a restart while an acceptance waits for the next day loses nothing: the next start finds the request again", async () => {
    const first = setup({ perDay: 1, pending: ["70001", "70002"] });
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(first.zalo.accepted.map((a) => a.userId)).toEqual(["70001"]);
    await first.assistant.stop();
    const saved = first.friendState.saved;
    expect(saved?.accepted).toEqual(["70001"]);
    await vi.advanceTimersByTimeAsync(15 * 60 * MINUTE);
    const second = setup({ perDay: 1, pending: ["70002"], friendState: saved });
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(second.zalo.accepted.map((a) => a.userId)).toEqual(["70002"]);
    await second.assistant.stop();
  });
});

describe("cutover: a member who joins the main group is welcomed, tagged, once ever", () => {
  it("welcomes the new members of one join in one message tagging each by name, with the group_welcome text", async () => {
    const { zalo, welcomeState, assistant } = setup();
    zalo.emit({ kind: "group_join", groupId: MAIN_GROUP, members: [{ userId: "70001", name: "Lan" }, { userId: "70002", name: "Minh Anh" }] });
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(zalo.sent).toHaveLength(1);
    expect(zalo.sent[0]).toMatchObject({ target: { kind: "group", groupId: MAIN_GROUP }, text: `@Lan @Minh Anh\n${messageText("group_welcome")}`, mentions: [{ userId: "70001", pos: 0, len: 4 }, { userId: "70002", pos: 5, len: 9 }] });
    expect(welcomeState.saved).toEqual([`${MAIN_GROUP}:70001`, `${MAIN_GROUP}:70002`]);
    zalo.emit({ kind: "group_join", groupId: MAIN_GROUP, members: [{ userId: "70001", name: "Lan" }] });
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(zalo.sent).toHaveLength(1);
    await assistant.stop();
  });

  it("never welcomes in a group that is not a welcome group (the Dev group in production)", async () => {
    const { zalo, assistant } = setup({ welcomeGroupIds: [MAIN_GROUP] });
    zalo.emit({ kind: "group_join", groupId: DEV_GROUP, members: [{ userId: "70001", name: "Lan" }] });
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(zalo.sent).toEqual([]);
    await assistant.stop();
  });

  it("a member without a name is welcomed untagged; the welcomed list survives a restart in group-welcomes.json", () => {
    expect(welcomeMessage([{ userId: "70003", name: null }])).toEqual({ text: messageText("group_welcome"), mentions: [] });
    const files = new Map<string, string>();
    const io = { readFile: (p: string) => files.get(p) ?? null, writeFile: (p: string, t: string) => void files.set(p, t), rename: (a: string, b: string) => void (files.set(b, files.get(a)!), files.delete(a)) };
    const warnings: string[] = [];
    const store = fileWelcomeStore("/data", io, (e) => void warnings.push(e));
    expect(store.load()).toBeNull();
    store.save([`${MAIN_GROUP}:70001`]);
    expect([...files.keys()].map((k) => k.replace(/\\/g, "/"))).toEqual([`/data/${WELCOME_STATE_FILE}`]);
    expect(fileWelcomeStore("/data", io, () => undefined).load()).toEqual([`${MAIN_GROUP}:70001`]);
    for (const key of files.keys()) files.set(key, "{broken");
    expect(store.load()).toBeNull();
    expect(warnings).toEqual(["assistant.welcome_state.missing", "assistant.welcome_state.unreadable"]);
  });
});

describe("cutover: a session another login took is reported at once", () => {
  it("sends a heartbeat with sessionConflict right away, and every later beat says so", async () => {
    const { server, zalo, errors, assistant } = setup();
    await vi.advanceTimersByTimeAsync(0);
    expect(server.callsTo(ASSISTANT_HEARTBEAT_PATH)).toHaveLength(1);
    expect(server.callsTo(ASSISTANT_HEARTBEAT_PATH)[0]).not.toHaveProperty("sessionConflict");
    zalo.emit({ kind: "session_conflict" });
    await vi.advanceTimersByTimeAsync(0);
    expect(server.callsTo(ASSISTANT_HEARTBEAT_PATH)).toHaveLength(2);
    expect(server.callsTo(ASSISTANT_HEARTBEAT_PATH)[1]).toMatchObject({ session: "disconnected", sessionConflict: true });
    expect(errors).toContain("assistant.zalo.session_conflict");
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(server.callsTo(ASSISTANT_HEARTBEAT_PATH).at(-1)).toMatchObject({ sessionConflict: true });
    await assistant.stop();
  });
});
