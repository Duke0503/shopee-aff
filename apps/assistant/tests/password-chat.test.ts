/**
 * Story 6.8 (assistant side): `/matkhau` answered once in the private chat with the new password
 * the server issued, through the pacer; refused in the group with the pointer to the private chat;
 * the password never reaches a log. The server side (the hash, the sessions ended) is in
 * apps/server/tests/customer-password.test.ts. Every Zalo session here is the in-memory fake.
 */
import { ASSISTANT_COMMAND_PATH } from "@cashback/contracts";
import { parseInstant, systemClock, toMs } from "@cashback/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startAssistant } from "../src/assistant";
import { fakeZaloSession, type FakeZaloSession } from "../src/fake-zalo.adapter";
import { internalApi } from "../src/internal-api.adapter";
import { messageText } from "../src/messages";
import { timerSleep } from "../src/pacer";
import { BASE, fakeServer, ok, TOKEN, type FakeServer } from "./fake-server";

const START = "2026-11-01T03:00:00.000Z";
const DEV_GROUP = "8786316503449470342";
const PASSWORD = "Kp7mWx3q";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(toMs(parseInstant(START)));
});
afterEach(() => {
  vi.useRealTimers();
});

const privately = (text: string) => ({ chat: { kind: "private" as const, userId: "70001" }, senderId: "70001", senderName: "Lan", text });
const inGroup = (text: string) => ({ chat: { kind: "group" as const, groupId: DEV_GROUP }, senderId: "70001", senderName: "Lan", text });

async function run(server: FakeServer, message: ReturnType<typeof privately> | ReturnType<typeof inGroup>): Promise<{ zalo: FakeZaloSession; errors: unknown[] }> {
  const zalo = fakeZaloSession(systemClock);
  const errors: unknown[] = [];
  const assistant = startAssistant({
    zalo,
    api: internalApi({ baseUrl: BASE, token: TOKEN, fetch: server.fetch }),
    clock: systemClock,
    sleep: timerSleep,
    sendDelay: { minMs: 6_000, maxMs: 12_000 },
    zaloGroupIds: [DEV_GROUP],
    friendRequestsPerDay: 30,
    onError: (event, error) => void errors.push({ event, error: error instanceof Error ? error.message : String(error) }),
    random: () => 0,
  });
  const done = zalo.deliver(message);
  await vi.advanceTimersByTimeAsync(30_000);
  await done;
  await assistant.stop();
  return { zalo, errors };
}

describe("Story 6.8: /matkhau issues a new password and ends other sessions", () => {
  it("AC1: /matkhau in a private chat sends the new password once, in the pacer's turn", async () => {
    const server = fakeServer();
    server.routes[ASSISTANT_COMMAND_PATH] = () => ok({ registered: false, customerCode: "DP00012", reply: { kind: "password", customerCode: "DP00012", password: PASSWORD } });
    const { zalo } = await run(server, privately("/matkhau"));
    expect(server.callsTo(ASSISTANT_COMMAND_PATH)).toEqual([{ zaloUserId: "70001", displayName: "Lan", chat: "private", command: "password" }]);
    expect(zalo.sent.map((s) => s.text)).toEqual([messageText("command_password", { password: PASSWORD, customerCode: "DP00012" })]);
    expect(zalo.sent[0]?.target).toEqual({ kind: "private", userId: "70001" });
    expect(zalo.sent.filter((s) => s.text.includes(PASSWORD))).toHaveLength(1);
  });

  it("AC2: the reply tells the customer every other sign-in has ended", () => {
    expect(messageText("command_password", { password: PASSWORD, customerCode: "DP00012" })).toMatch(/\u0111\u0103ng xu\u1ea5t/u);
  });

  it("AC3: /matkhau in the group is refused with the pointer to the private chat and no password", async () => {
    const server = fakeServer();
    server.routes[ASSISTANT_COMMAND_PATH] = () => ok({ registered: false, customerCode: null, reply: { kind: "private_only" } });
    const { zalo } = await run(server, inGroup("/matkhau"));
    expect(server.callsTo(ASSISTANT_COMMAND_PATH)).toEqual([{ zaloUserId: "70001", displayName: "Lan", chat: "group", command: "password" }]);
    expect(zalo.sent.map((s) => s.text)).toEqual([`@Lan\n${messageText("command_private_only")}`]);
  });

  it("AC4: the password value never appears in a log: the logged events name the error only, and the logger redacts message text", async () => {
    const server = fakeServer();
    server.routes[ASSISTANT_COMMAND_PATH] = () => ok({ registered: false, customerCode: "DP00012", reply: { kind: "password", customerCode: "DP00012", password: PASSWORD } });
    const zalo = fakeZaloSession(systemClock);
    const failing = { ...zalo, sendText: async () => Promise.reject(new Error("zalo send failed")) };
    const errors: unknown[] = [];
    const assistant = startAssistant({
      zalo: failing,
      api: internalApi({ baseUrl: BASE, token: TOKEN, fetch: server.fetch }),
      clock: systemClock,
      sleep: timerSleep,
      sendDelay: { minMs: 6_000, maxMs: 12_000 },
      zaloGroupIds: [DEV_GROUP],
      friendRequestsPerDay: 30,
      onError: (event, error) => void errors.push({ event, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }),
      random: () => 0,
    });
    const done = zalo.deliver(privately("/matkhau"));
    await vi.advanceTimersByTimeAsync(30_000);
    await done;
    await assistant.stop();
    expect(errors).toContainEqual({ event: "assistant.message.failed", error: "Error: zalo send failed" });
    expect(JSON.stringify(errors)).not.toContain(PASSWORD);
    const { REDACT_PATHS } = await import("../src/assistant-log");
    expect(REDACT_PATHS).toContain("text");
  });
});
