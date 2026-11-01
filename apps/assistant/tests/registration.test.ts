/**
 * Story 6.2 (assistant side): a first private message registers its sender through the internal
 * api and gets the paced welcome with the customer code; a person seen before is not welcomed
 * again; a group member who sends no link is never registered. The server side (one customer, the
 * next DP code, aliases, no public route) is in apps/server/tests/assistant-registration.test.ts.
 */
import { ASSISTANT_LINK_REQUEST_PATH, ASSISTANT_REGISTRATION_PATH } from "@cashback/contracts";
import { parseInstant, systemClock, toMs } from "@cashback/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startAssistant } from "../src/assistant";
import { fakeZaloSession, type FakeZaloSession } from "../src/fake-zalo.adapter";
import { internalApi } from "../src/internal-api.adapter";
import { messageText } from "../src/messages";
import { timerSleep } from "../src/pacer";
import { BASE, fakeServer, TOKEN, type FakeServer } from "./fake-server";

const START = "2026-11-01T03:00:00.000Z";
const DEV_GROUP = "8786316503449470342";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(toMs(parseInstant(START)));
});
afterEach(() => {
  vi.useRealTimers();
});

function start(server: FakeServer): { zalo: FakeZaloSession; stop: () => Promise<void>; onError: ReturnType<typeof vi.fn> } {
  const zalo = fakeZaloSession(systemClock);
  const onError = vi.fn();
  const assistant = startAssistant({
    zalo,
    api: internalApi({ baseUrl: BASE, token: TOKEN, fetch: server.fetch }),
    clock: systemClock,
    sleep: timerSleep,
    sendDelay: { minMs: 6_000, maxMs: 12_000 },
    zaloGroupIds: [DEV_GROUP],
    friendRequestsPerDay: 30,
    onError,
    random: () => 0,
  });
  return { zalo, onError, stop: () => assistant.stop() };
}

const privateFrom = (userId: string, text: string) => ({ chat: { kind: "private" as const, userId }, senderId: userId, senderName: "Lan", text });

describe("Story 6.2: registration from Zalo", () => {
  it("AC1: a first private message from an unknown Zalo id registers the sender and gets the welcome with the code, paced", async () => {
    const server = fakeServer();
    const { zalo, stop } = start(server);
    const first = zalo.deliver(privateFrom("70001", "hi"));
    const second = zalo.deliver(privateFrom("70002", "xin chao"));
    await vi.advanceTimersByTimeAsync(0);
    expect(server.callsTo(ASSISTANT_REGISTRATION_PATH)).toEqual([
      { zaloUserId: "70001", displayName: "Lan" },
      { zaloUserId: "70002", displayName: "Lan" },
    ]);
    expect(zalo.sent.map((s) => s.text)).toEqual([messageText("welcome", { customerCode: "DP00001" })]);
    await vi.advanceTimersByTimeAsync(5_999);
    expect(zalo.sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([first, second]);
    expect(zalo.sent.map((s) => [s.target, s.text])).toEqual([
      [{ kind: "private", userId: "70001" }, messageText("welcome", { customerCode: "DP00001" })],
      [{ kind: "private", userId: "70002" }, messageText("welcome", { customerCode: "DP00002" })],
    ]);
    expect(toMs(zalo.sent[1]!.at) - toMs(zalo.sent[0]!.at)).toBeGreaterThanOrEqual(6_000);
    expect(messageText("welcome", { customerCode: "DP00001" })).toContain("DP00001");
    await stop();
  });

  it("AC2: the same Zalo id writing again is not welcomed again and is asked for a link", async () => {
    const server = fakeServer();
    const { zalo, stop } = start(server);
    await zalo.deliver(privateFrom("70001", "hi"));
    const again = zalo.deliver(privateFrom("70001", "hello again"));
    await vi.advanceTimersByTimeAsync(12_000);
    await again;
    expect(zalo.sent.map((s) => s.text)).toEqual([messageText("welcome", { customerCode: "DP00001" }), messageText("send_a_link")]);
    expect(server.callsTo(ASSISTANT_REGISTRATION_PATH)).toHaveLength(2);
    await stop();
  });

  it("review 5: a known customer writing without a link is asked for one at most once a Vietnam day, else left to staff", async () => {
    const server = fakeServer();
    const { zalo, stop } = start(server);
    await zalo.deliver(privateFrom("70001", "hi"));
    for (const text of ["cam on", "con don hom qua thi sao", "?"]) {
      const next = zalo.deliver(privateFrom("70001", text));
      await vi.advanceTimersByTimeAsync(12_000);
      await next;
    }
    expect(zalo.sent.map((s) => s.text)).toEqual([messageText("welcome", { customerCode: "DP00001" }), messageText("send_a_link")]);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    const tomorrow = zalo.deliver(privateFrom("70001", "chao"));
    await vi.advanceTimersByTimeAsync(12_000);
    await tomorrow;
    expect(zalo.sent.map((s) => s.text).slice(2)).toEqual([messageText("send_a_link")]);
    await stop();
  });

  it("AC3: a group member who writes without a link is never registered and gets no reply", async () => {
    const server = fakeServer();
    const { zalo, stop } = start(server);
    await zalo.deliver({ chat: { kind: "group", groupId: DEV_GROUP }, senderId: "70009", text: "chao ca nha" });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(server.callsTo(ASSISTANT_REGISTRATION_PATH)).toEqual([]);
    expect(server.callsTo(ASSISTANT_LINK_REQUEST_PATH)).toEqual([]);
    expect(zalo.sent).toEqual([]);
    await stop();
  });

  it("a failed registration is reported, never answered with a made-up code", async () => {
    const server = fakeServer();
    server.routes[ASSISTANT_REGISTRATION_PATH] = () => ({ status: 503, body: {} });
    const { zalo, onError, stop } = start(server);
    await zalo.deliver(privateFrom("70001", "hi"));
    expect(zalo.sent).toEqual([]);
    expect(onError).toHaveBeenCalledWith("assistant.message.failed", expect.any(Error));
    expect(String(onError.mock.calls[0]![1])).not.toContain(TOKEN);
    await stop();
  });
});
