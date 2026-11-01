/**
 * Story 6.11 (assistant side): a lost Zalo session, played by the fake (no test logs in to Zalo),
 * is reported in the heartbeat and logged once; while it is lost no notification is pulled, so
 * every due one waits on the server and goes out once the session is back. The owner alert, the
 * down state, the 7-day drop and the merge proposals are the server's
 * (apps/server/tests/assistant-down.test.ts).
 */
import { ASSISTANT_HEARTBEAT_PATH, ASSISTANT_REGISTRATION_PATH, NOTIFICATION_ACK_ROUTE, NOTIFICATION_NEXT_PATH, type AssistantNotification } from "@cashback/contracts";
import { parseInstant, systemClock, toMs } from "@cashback/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startAssistant } from "../src/assistant";
import { FAKE_ACCOUNT_ID, fakeZaloSession } from "../src/fake-zalo.adapter";
import { internalApi } from "../src/internal-api.adapter";
import { messageText } from "../src/messages";
import { timerSleep } from "../src/pacer";
import { BASE, fakeServer, ok, TOKEN } from "./fake-server";

const START = "2026-11-01T03:00:00.000Z";
const MINUTE = 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(toMs(parseInstant(START)));
});
afterEach(() => {
  vi.useRealTimers();
});

const due: AssistantNotification = { id: 7, dedupKey: "link_request:26110100007:failed", zaloUserId: "70007", messageKey: "link_failed", params: { requestId: "26110100007" }, link: null };

/** `lost`: Zalo has closed the session before the assistant starts (the account locked overnight). */
function setup(lost = true) {
  const server = fakeServer();
  let acked = false;
  server.routes[NOTIFICATION_NEXT_PATH] = () => ok({ notification: acked ? null : due });
  server.routes[NOTIFICATION_ACK_ROUTE] = (body) => {
    acked = true;
    return ok({ id: body["id"], outcome: "sent" });
  };
  const zalo = fakeZaloSession(systemClock);
  if (lost) zalo.lose();
  const errors: string[] = [];
  const assistant = startAssistant({
    zalo,
    api: internalApi({ baseUrl: BASE, token: TOKEN, fetch: server.fetch }),
    clock: systemClock,
    sleep: timerSleep,
    sendDelay: { minMs: 6_000, maxMs: 12_000 },
    zaloGroupIds: [],
    friendRequestsPerDay: 30,
    onError: (event) => void errors.push(event),
    random: () => 0,
    notificationIdleMs: 10_000,
  });
  return { server, zalo, errors, assistant };
}

describe("Story 6.11: Zalo account loss keeps customers served and alerts the owner", () => {
  it("AC1: a lost session is reported in the next heartbeat and logged once, so the server can alert the owner", async () => {
    const { server, zalo, errors, assistant } = setup(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.callsTo(ASSISTANT_HEARTBEAT_PATH)[0]).toMatchObject({ session: "connected" });
    zalo.lose();
    await vi.advanceTimersByTimeAsync(3 * MINUTE);
    const beats = server.callsTo(ASSISTANT_HEARTBEAT_PATH).slice(1);
    expect(beats[0]).toMatchObject({ zalo: "fake", session: "disconnected" });
    expect(beats.length).toBeGreaterThanOrEqual(3);
    expect(beats.every((b) => b["session"] === "disconnected")).toBe(true);
    expect(errors.filter((e) => e === "assistant.zalo.session_lost")).toHaveLength(1);
    await assistant.stop();
  });

  it("AC2: while the session is lost no notification is pulled; it waits and is delivered once the session is back", async () => {
    const { server, zalo, assistant } = setup();
    await vi.advanceTimersByTimeAsync(30 * MINUTE);
    expect(server.callsTo(NOTIFICATION_NEXT_PATH)).toEqual([]);
    expect(zalo.sent).toEqual([]);
    zalo.regain();
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(zalo.sent.map((s) => s.text)).toEqual([messageText("link_failed")]);
    expect(zalo.sent[0]?.target).toEqual({ kind: "private", userId: "70007" });
    await assistant.stop();
  });

  it("AC4: once the session is back the heartbeat says connected again", async () => {
    const { server, zalo, assistant } = setup();
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    zalo.regain();
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    expect(server.callsTo(ASSISTANT_HEARTBEAT_PATH).at(-1)).toMatchObject({ session: "connected" });
    await assistant.stop();
  });

  it("review 3: a session that is not open yet at start is no loss; it is reported disconnected, and lost once only after it connected", async () => {
    const { server, zalo, errors, assistant } = setup();
    await vi.advanceTimersByTimeAsync(3 * MINUTE);
    expect(server.callsTo(ASSISTANT_HEARTBEAT_PATH).every((b) => b["session"] === "disconnected")).toBe(true);
    expect(errors).not.toContain("assistant.zalo.session_lost");
    zalo.regain();
    await vi.advanceTimersByTimeAsync(MINUTE);
    zalo.lose();
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    expect(errors.filter((e) => e === "assistant.zalo.session_lost")).toHaveLength(1);
    await assistant.stop();
  });

  it("decision: every heartbeat names the session's own Zalo account, so the server sees a new account when it is connected", async () => {
    const { server, assistant } = setup(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(server.callsTo(ASSISTANT_HEARTBEAT_PATH)[0]).toMatchObject({ account: FAKE_ACCOUNT_ID });
    await assistant.stop();
  });

  it("decision: a known customer writing their old code under the new account is told the claim was noted; nothing else is sent for it", async () => {
    const { server, zalo, assistant } = setup(false);
    server.routes[ASSISTANT_REGISTRATION_PATH] = () => ok({ customerId: "80001", customerCode: "DP00101", created: true, claim: "recorded" });
    const done = zalo.deliver({ chat: { kind: "private", userId: "80001" }, senderId: "80001", senderName: "Lan", text: "m\u00e3 c\u0169 c\u1ee7a m\u00ecnh l\u00e0 dp00012" });
    await vi.advanceTimersByTimeAsync(MINUTE);
    await done;
    expect(server.callsTo(ASSISTANT_REGISTRATION_PATH)).toEqual([{ zaloUserId: "80001", displayName: "Lan", claimedCode: "DP00012" }]);
    expect(zalo.sent.filter((s) => s.target.kind === "private" && s.target.userId === "80001").map((s) => s.text)).toEqual([messageText("welcome", { customerCode: "DP00101" }), messageText("merge_claim_noted", { claimedCode: "DP00012" })]);
    await assistant.stop();
  });
});
