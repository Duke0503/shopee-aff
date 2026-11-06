/**
 * D65 (assistant side): while the server says the Shopee queue is stopped, the sender of a link is
 * told at once and the wait ends. The server side is in apps/server/tests/link-stuck-notices.test.ts.
 */
import { ASSISTANT_LINK_REPLY_PATH } from "@cashback/contracts";
import { parseInstant, systemClock, toMs } from "@cashback/core";
import messages from "@cashback/labels/vi/messages.json" with { type: "json" };
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startAssistant } from "../src/assistant";
import { REPLY_POLL_MS, REPLY_WAIT_MS } from "../src/chat-reply";
import { fakeZaloSession, type FakeZaloSession } from "../src/fake-zalo.adapter";
import { internalApi } from "../src/internal-api.adapter";
import { messageText } from "../src/messages";
import { timerSleep } from "../src/pacer";
import { BASE, fakeServer, ok, replyOf, TOKEN, type FakeServer } from "./fake-server";

const START = "2026-11-06T03:00:00.000Z";
const DEV_GROUP = "8786316503449470342";
const PRODUCT = "https://shopee.vn/Ao-thun-i.11001.22001";
const SHARE = "https://hoantiendp.com/s/AbCdEf1234";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(toMs(parseInstant(START)));
});
afterEach(() => {
  vi.useRealTimers();
});

function start(server: FakeServer): { zalo: FakeZaloSession; stop: () => Promise<void> } {
  const zalo = fakeZaloSession(systemClock);
  const assistant = startAssistant({ zalo, api: internalApi({ baseUrl: BASE, token: TOKEN, fetch: server.fetch }), clock: systemClock, sleep: timerSleep, sendDelay: { minMs: 6_000, maxMs: 12_000 }, zaloGroupIds: [DEV_GROUP], friendRequestsPerDay: 30, onError: vi.fn(), random: () => 0.999 });
  return { zalo, stop: () => assistant.stop() };
}

const fromPrivate = { chat: { kind: "private" as const, userId: "70001" }, senderId: "70001", text: PRODUCT };
const replyPolls = (server: FakeServer): number => server.callsTo(ASSISTANT_LINK_REPLY_PATH).length;

async function sendAndSettle(server: FakeServer, zalo: FakeZaloSession, message: Parameters<FakeZaloSession["deliver"]>[0] = fromPrivate): Promise<string[]> {
  const done = zalo.deliver(message);
  await vi.advanceTimersByTimeAsync(REPLY_WAIT_MS + 30_000);
  await done;
  return zalo.sent.map((s) => s.text);
}

describe("a link sent while the Shopee queue is stopped (D65)", () => {
  it("has the owner-approved words, with no date or time promise", () => {
    expect((messages as Record<string, string>)["link_queue_stopped"]).toBe("\u23f3 H\u1ec7 th\u1ed1ng \u0111ang g\u1eb7p tr\u1ee5c tr\u1eb7c khi t\u1ea1o link t\u1eeb Shopee, c\u00f3 th\u1ec3 do \u0111\u01b0\u1eddng truy\u1ec1n ch\u01b0a \u1ed5n \u0111\u1ecbnh.\n\nB\u1ea1n ch\u1edd m\u00ecnh m\u1ed9t ch\u00fat nh\u00e9, t\u1ea1o xong m\u00ecnh s\u1ebd g\u1eedi link ngay.");
    expect(messageText("link_queue_stopped")).not.toMatch(/\d/);
  });

  it("tells the sender on the first poll, without waiting out the reply wait", async () => {
    const server = fakeServer();
    server.routes[ASSISTANT_LINK_REPLY_PATH] = (body) => ok(replyOf(String(body["requestId"]), { queueStopped: true }));
    const { zalo, stop } = start(server);
    const texts = await sendAndSettle(server, zalo);
    expect(texts.at(-1)).toBe(messageText("link_queue_stopped"));
    expect(texts).not.toContain(messageText("link_on_its_way"));
    expect(replyPolls(server)).toBe(1);
    await stop();
  });

  it("a group reply still tags the sender", async () => {
    const server = fakeServer();
    server.routes[ASSISTANT_LINK_REPLY_PATH] = (body) => ok(replyOf(String(body["requestId"]), { queueStopped: true }));
    const { zalo, stop } = start(server);
    await sendAndSettle(server, zalo, { chat: { kind: "group", groupId: DEV_GROUP }, senderId: "70001", senderName: "Lan", text: PRODUCT });
    const sent = zalo.sent.at(-1);
    expect(sent?.text).toBe(`@Lan\n${messageText("link_queue_stopped")}`);
    expect(sent?.mentions).toEqual([{ userId: "70001", pos: 0, len: 4 }]);
    await stop();
  });

  it("a captcha during the wait is told on the next poll", async () => {
    const server = fakeServer();
    let polls = 0;
    server.routes[ASSISTANT_LINK_REPLY_PATH] = (body) => ok(replyOf(String(body["requestId"]), ++polls >= 3 ? { queueStopped: true } : {}));
    const { zalo, stop } = start(server);
    const texts = await sendAndSettle(server, zalo);
    expect(texts.at(-1)).toBe(messageText("link_queue_stopped"));
    expect(replyPolls(server)).toBe(3);
    expect(3 * REPLY_POLL_MS).toBeLessThan(REPLY_WAIT_MS);
    await stop();
  });

  it("a server that cannot be reached still gives the existing 'on its way'", async () => {
    const server = fakeServer();
    server.routes[ASSISTANT_LINK_REPLY_PATH] = () => {
      throw new Error("offline");
    };
    const { zalo, stop } = start(server);
    const texts = await sendAndSettle(server, zalo);
    expect(texts.at(-1)).toBe(messageText("link_on_its_way"));
    expect(texts).not.toContain(messageText("link_queue_stopped"));
    await stop();
  });

  it("a link already made gets the normal reply, and no captcha changes nothing", async () => {
    const made = fakeServer();
    made.routes[ASSISTANT_LINK_REPLY_PATH] = (body) => ok(replyOf(String(body["requestId"]), { status: "ISSUED", shareUrl: SHARE, factsSettled: true }));
    const first = start(made);
    const madeTexts = await sendAndSettle(made, first.zalo);
    expect(madeTexts.at(-1)).toContain(SHARE);
    expect(madeTexts).not.toContain(messageText("link_queue_stopped"));
    await first.stop();
    const open = fakeServer();
    const second = start(open);
    const openTexts = await sendAndSettle(open, second.zalo);
    expect(openTexts.at(-1)).toBe(messageText("link_on_its_way"));
    expect(replyPolls(open)).toBeGreaterThan(1);
    await second.stop();
  });
});
