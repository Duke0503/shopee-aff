/**
 * Story 6.3 (assistant side): a product link pasted in Zalo is asked for once, for its sender, and
 * answered with the share link, the product, the price and "khoang <amount>d", within 30 seconds of
 * a fake server that makes the link like the fake bridge does (the next link job run, 5 s). The
 * server side (sub_id1, the reply facts, the share link) is in
 * apps/server/tests/assistant-link-reply.test.ts.
 */
import { ASSISTANT_LINK_REPLY_PATH, ASSISTANT_LINK_REQUEST_PATH, ASSISTANT_REGISTRATION_PATH, DISPLAY_NAME_MAX_LENGTH, LINK_REFUSALS } from "@cashback/contracts";
import { parseInstant, systemClock, toMs } from "@cashback/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startAssistant } from "../src/assistant";
import { REPLY_WAIT_MS } from "../src/chat-reply";
import { REFUSAL_REPLIES } from "../src/link-reply-text";
import { fakeZaloSession, type FakeZaloSession } from "../src/fake-zalo.adapter";
import { internalApi } from "../src/internal-api.adapter";
import { messageText } from "../src/messages";
import { timerSleep } from "../src/pacer";
import { BASE, fakeServer, ok, refused, replyOf, TOKEN, type FakeServer } from "./fake-server";

const START = "2026-11-01T03:00:00.000Z";
const DEV_GROUP = "8786316503449470342";
const PRODUCT = "https://shopee.vn/Ao-thun-i.11001.22001";
const SHARE = "https://hoantiendp.com/s/AbCdEf1234";
const ABOUT = "kho\u1ea3ng";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(toMs(parseInstant(START)));
});
afterEach(() => {
  vi.useRealTimers();
});

function start(server: FakeServer, random = () => 0.999): { zalo: FakeZaloSession; stop: () => Promise<void> } {
  const zalo = fakeZaloSession(systemClock);
  const assistant = startAssistant({
    zalo,
    api: internalApi({ baseUrl: BASE, token: TOKEN, fetch: server.fetch }),
    clock: systemClock,
    sleep: timerSleep,
    sendDelay: { minMs: 6_000, maxMs: 12_000 },
    zaloGroupIds: [DEV_GROUP],
    friendRequestsPerDay: 30,
    onError: vi.fn(),
    random,
  });
  return { zalo, stop: () => assistant.stop() };
}

/** The link is made at the link job's next run, 5 s after the request, with the product facts. */
function linkMadeAfter(server: FakeServer, ms: number, over: Parameters<typeof replyOf>[1] = {}): void {
  const madeAt = toMs(systemClock.now()) + ms;
  server.routes[ASSISTANT_LINK_REPLY_PATH] = (body) =>
    ok(
      toMs(systemClock.now()) < madeAt
        ? replyOf(String(body["requestId"]))
        : replyOf(String(body["requestId"]), { status: "ISSUED", shareUrl: SHARE, factsSettled: true, product: { name: "Ao thun", price: 150_000 }, estimate: { cashback: 12_345, shareBps: 8_000, withheld: true }, ...over }),
    );
}

const privateFrom = (userId: string, text: string) => ({ chat: { kind: "private" as const, userId }, senderId: userId, text });

describe("Story 6.3: a product link pasted in Zalo", () => {
  it("AC1: in a private chat the reply has the product, the price, 'khoang <amount>d' and the share link, within 30 s", async () => {
    const server = fakeServer();
    linkMadeAfter(server, 5_000);
    const { zalo, stop } = start(server);
    const done = zalo.deliver(privateFrom("70001", `xem cai nay ${PRODUCT}`));
    await vi.advanceTimersByTimeAsync(30_000);
    await done;
    expect(zalo.sent).toHaveLength(2);
    const reply = zalo.sent[1]!;
    expect(reply.target).toEqual({ kind: "private", userId: "70001" });
    expect(reply.text).toContain(SHARE);
    expect(reply.text).toContain("Ao thun");
    expect(reply.text).toContain("150.000\u0111");
    expect(reply.text).toContain(`${ABOUT} 12.345\u0111`);
    expect(reply.text).toContain("80%");
    expect(reply.text).not.toContain("shopee.vn");
    expect(toMs(reply.at) - toMs(parseInstant(START))).toBeLessThan(30_000);
    expect(server.callsTo(ASSISTANT_LINK_REQUEST_PATH)).toEqual([{ zaloUserId: "70001", displayName: null, chat: "private", url: PRODUCT }]);
    expect(server.callsTo(ASSISTANT_REGISTRATION_PATH)).toEqual([]);
    await stop();
  });

  it("AC1: a link without an estimate says so instead of an amount, and ShopeeFood names no amount", async () => {
    const server = fakeServer();
    linkMadeAfter(server, 0, { estimate: null, product: { name: null, price: null } });
    const { zalo, stop } = start(server);
    await zalo.deliver(privateFrom("70001", "hi"));
    const plain = zalo.deliver(privateFrom("70001", PRODUCT));
    await vi.advanceTimersByTimeAsync(30_000);
    await plain;
    expect(zalo.sent[1]!.text).toBe(messageText("link_ready_no_estimate", { link: SHARE, product: "\u2013", price: "\u2013" }));
    linkMadeAfter(server, 0, { perShop: true, estimate: null });
    const food = zalo.deliver(privateFrom("70001", "https://shopeefood.vn/ha-noi/quan-ngon"));
    await vi.advanceTimersByTimeAsync(30_000);
    await food;
    expect(zalo.sent[2]!.text).toBe(messageText("link_ready_shopeefood", { link: SHARE }));
    expect(zalo.sent[2]!.text).not.toMatch(/\d\u0111/);
    await stop();
  });

  it("AC2: a link not ready within the reply wait gets 'on its way' and no second request is made", async () => {
    const server = fakeServer();
    const { zalo, stop } = start(server);
    const done = zalo.deliver(privateFrom("70001", PRODUCT));
    await vi.advanceTimersByTimeAsync(REPLY_WAIT_MS + 15_000);
    await done;
    expect(zalo.sent.map((s) => s.text)).toEqual([messageText("welcome", { customerCode: "DP00001" }), messageText("link_on_its_way")]);
    expect(server.callsTo(ASSISTANT_LINK_REQUEST_PATH)).toHaveLength(1);
    expect(server.callsTo(ASSISTANT_LINK_REPLY_PATH).length).toBeGreaterThan(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(server.callsTo(ASSISTANT_LINK_REQUEST_PATH)).toHaveLength(1);
    await stop();
  });

  it("AC3: a Lazada link gets the polite refusal naming the supported networks", async () => {
    const server = fakeServer();
    server.routes[ASSISTANT_LINK_REQUEST_PATH] = () => refused("network_unsupported", true);
    const { zalo, stop } = start(server);
    const done = zalo.deliver(privateFrom("70001", "https://www.lazada.vn/products/ao-i123.html"));
    await vi.advanceTimersByTimeAsync(15_000);
    await done;
    expect(zalo.sent.map((s) => s.text)).toEqual([messageText("welcome", { customerCode: "DP00001" }), messageText("link_network_unsupported")]);
    for (const network of ["Shopee", "ShopeeFood", "TikTok Shop"]) expect(zalo.sent[1]!.text).toContain(network);
    expect(server.callsTo(ASSISTANT_LINK_REPLY_PATH)).toEqual([]);
    await stop();
  });

  it("AC4: a link pasted in the group is asked for its sender alone and answered in the group", async () => {
    const server = fakeServer();
    linkMadeAfter(server, 5_000);
    const { zalo, stop } = start(server);
    const done = zalo.deliver({ chat: { kind: "group", groupId: DEV_GROUP }, senderId: "70005", senderName: "Minh", text: PRODUCT });
    await vi.advanceTimersByTimeAsync(30_000);
    await done;
    expect(server.callsTo(ASSISTANT_REGISTRATION_PATH)).toEqual([]);
    expect(server.callsTo(ASSISTANT_LINK_REQUEST_PATH)).toEqual([{ zaloUserId: "70005", displayName: "Minh", chat: "group", url: PRODUCT }]);
    expect(server.callsTo(ASSISTANT_LINK_REPLY_PATH)[0]).toEqual({ requestId: "26110100001", customerId: "70005" });
    expect(zalo.sent.map((s) => s.target)).toEqual([{ kind: "group", groupId: DEV_GROUP }]);
    expect(zalo.sent[0]!.text).toContain(SHARE);
    // Owner decision: a group reply tags the sender.
    expect(zalo.sent[0]!.text.startsWith("@Minh\n")).toBe(true);
    expect(zalo.sent[0]!.mentions).toEqual([{ userId: "70005", pos: 0, len: 5 }]);
    await stop();
  });
});

const groupFrom = (userId: string, text: string, senderName: string | null = "Minh") => ({ chat: { kind: "group" as const, groupId: DEV_GROUP }, senderId: userId, senderName, text });

describe("Story 6.3: Sprint 25 review", () => {
  it("review 1: every refusal the link route can give has a reply in the private chat, day_full included", async () => {
    for (const reason of LINK_REFUSALS) {
      const key = REFUSAL_REPLIES[reason].private;
      expect(messageText(key)).not.toBe("");
      const server = fakeServer();
      server.routes[ASSISTANT_LINK_REQUEST_PATH] = () => refused(reason);
      const { zalo, stop } = start(server);
      const done = zalo.deliver(privateFrom("70001", PRODUCT));
      await vi.advanceTimersByTimeAsync(15_000);
      await done;
      expect([reason, zalo.sent.map((s) => s.text)]).toEqual([reason, [messageText(key)]]);
      await stop();
    }
    expect(REFUSAL_REPLIES.day_full.private).toBe("link_day_full");
  });

  it("review 2: a display name longer than the server keeps is cut before sending, never refused", async () => {
    const server = fakeServer();
    linkMadeAfter(server, 0);
    const { zalo, stop } = start(server);
    const done = zalo.deliver({ ...privateFrom("70001", PRODUCT), senderName: `  ${"N".repeat(300)}  ` });
    await vi.advanceTimersByTimeAsync(30_000);
    await done;
    expect(server.callsTo(ASSISTANT_LINK_REQUEST_PATH)[0]!["displayName"]).toBe("N".repeat(DISPLAY_NAME_MAX_LENGTH));
    expect(zalo.sent).toHaveLength(2);
    await stop();
  });

  it("review 3 and 10: a first private message with a link makes one call, and with the longest pacer delays welcome and reply both go out within 30 s", async () => {
    const server = fakeServer();
    linkMadeAfter(server, 5_000);
    const { zalo, stop } = start(server, () => 0.999_999);
    const done = zalo.deliver(privateFrom("70001", PRODUCT));
    await vi.advanceTimersByTimeAsync(30_000);
    await done;
    expect(server.calls.filter((c) => c.path !== ASSISTANT_LINK_REPLY_PATH && !c.path.includes("heartbeat") && !c.path.includes("notifications") && !c.path.includes("/link-replies/")).map((c) => c.path)).toEqual([ASSISTANT_LINK_REQUEST_PATH]);
    expect(zalo.sent.map((s) => s.text)).toEqual([messageText("welcome", { customerCode: "DP00001" }), expect.stringContaining(SHARE)]);
    expect(toMs(zalo.sent[1]!.at) - toMs(parseInstant(START))).toBeLessThanOrEqual(12_000);
    expect(toMs(zalo.sent[1]!.at) - toMs(zalo.sent[0]!.at)).toBeGreaterThanOrEqual(12_000);
    await stop();
  });

  it("review 4: in the group a link to no shop gets no reply; an unsupported shop gets the tagged refusal", async () => {
    const server = fakeServer();
    server.routes[ASSISTANT_LINK_REQUEST_PATH] = (body) => refused(String(body["url"]).includes("lazada") ? "network_unsupported" : "not_a_shop_link");
    const { zalo, stop } = start(server);
    await zalo.deliver(groupFrom("70005", "doc bao nay https://vnexpress.net/tin-1.html"));
    expect(zalo.sent).toEqual([]);
    const done = zalo.deliver(groupFrom("70005", "https://www.lazada.vn/products/ao-i123.html"));
    await vi.advanceTimersByTimeAsync(15_000);
    await done;
    expect(zalo.sent.map((s) => [s.text, s.mentions])).toEqual([[`@Minh\n${messageText("link_network_unsupported")}`, [{ userId: "70005", pos: 0, len: 5 }]]]);
    const privately = zalo.deliver(privateFrom("70001", "https://vnexpress.net/tin-1.html"));
    await vi.advanceTimersByTimeAsync(15_000);
    await privately;
    expect(zalo.sent.at(-1)!.text).toBe(messageText("link_network_unsupported"));
    await stop();
  });

  it("review 6: a poll the server does not answer during the wait ends with 'on its way', never silence", async () => {
    const server = fakeServer();
    server.routes[ASSISTANT_LINK_REPLY_PATH] = () => ({ status: 503, body: {} });
    const { zalo, stop } = start(server);
    await zalo.deliver(privateFrom("70001", "hi"));
    const done = zalo.deliver(privateFrom("70001", PRODUCT));
    await vi.advanceTimersByTimeAsync(REPLY_WAIT_MS + 15_000);
    await done;
    expect(zalo.sent.at(-1)!.text).toBe(messageText("link_on_its_way"));
    expect(server.callsTo(ASSISTANT_LINK_REPLY_PATH).length).toBeGreaterThan(1);
    await stop();
  });
});
