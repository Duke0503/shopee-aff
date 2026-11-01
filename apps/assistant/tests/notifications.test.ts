/**
 * Stories 6.4 and 6.5 (assistant side): the outbox pulled one notification at a time, sent in the
 * pacer's turn, recorded in the sent-notifications file and acknowledged; a notification handed
 * out again (a crash or a lost ack between the send and the ack) is acknowledged without a second
 * send; and a link reply claims its link so it is told once. The server side (lease, back-off,
 * daily cap, 7-day drop, the 55 s check) is in apps/server/tests/notification-outbox.test.ts and
 * link-delivery.test.ts. Every Zalo session here is the in-memory fake.
 */
import { join } from "node:path";
import { ASSISTANT_LINK_CLAIM_PATH, ASSISTANT_LINK_CONFIRM_PATH, ASSISTANT_LINK_RELEASE_PATH, ASSISTANT_LINK_REPLY_PATH, NOTIFICATION_ACK_ROUTE, NOTIFICATION_NEXT_PATH, type AssistantNotification } from "@cashback/contracts";
import { fixedClock, parseInstant, systemClock, toMs } from "@cashback/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startAssistant } from "../src/assistant";
import { fakeZaloSession, type FakeZaloSession } from "../src/fake-zalo.adapter";
import type { StateFiles } from "../src/friend-state-file.adapter";
import { internalApi, type FetchLike } from "../src/internal-api.adapter";
import messages from "@cashback/labels/vi/messages.json" with { type: "json" };
import { MessageIncompleteError, messageText, placeholdersOf, type MessageKey } from "../src/messages";
import { deliverNext, type NotificationDeps } from "../src/notification.job";
import { linkReplyMessage } from "../src/link-reply-text";
import { timerSleep } from "../src/pacer";
import { fileSentNotifications, memorySentNotifications, SENT_NOTIFICATIONS_FILE, type SentNotifications } from "../src/sent-notifications-file.adapter";
import { BASE, fakeServer, ok, replyOf, TOKEN, type FakeServer } from "./fake-server";

const START = "2026-11-01T03:00:00.000Z";
const DEV_GROUP = "8786316503449470342";
const SHARE = "https://hoantiendp.com/s/AbCdEf1234";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(toMs(parseInstant(START)));
});
afterEach(() => {
  vi.useRealTimers();
});

const notification = (id: number, over: Partial<AssistantNotification> = {}): AssistantNotification => ({
  id,
  dedupKey: `link_request:2611010000${id}:failed`,
  zaloUserId: `7000${id}`,
  messageKey: "link_failed",
  params: { requestId: `2611010000${id}` },
  link: null,
  ...over,
});

/**
 * The server's outbox as the assistant sees it: the oldest unacknowledged row not leased, leased on
 * handout; `releaseLeases` is time passing until a lease runs out. `ackFails` loses the ack.
 */
function outboxServer(server: FakeServer, rows: AssistantNotification[]) {
  const acked = new Map<number, string>();
  const leased = new Set<number>();
  const state = { ackFails: false, releaseLeases: () => leased.clear(), acked, handouts: 0 };
  server.routes[NOTIFICATION_NEXT_PATH] = () => {
    const row = rows.find((r) => !acked.has(r.id) && !leased.has(r.id)) ?? null;
    if (row !== null) {
      leased.add(row.id);
      state.handouts++;
    }
    return ok({ notification: row });
  };
  server.routes[NOTIFICATION_ACK_ROUTE] = (body) => {
    if (state.ackFails) return { status: 503, body: { error: { code: "unavailable", messageKey: "error.unavailable" } } };
    const id = Number(body["id"]);
    if (!acked.has(id)) acked.set(id, String(body["result"]));
    return ok({ id, outcome: "sent" });
  };
  return state;
}

function memoryFiles(): StateFiles & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    readFile: (path) => files.get(path) ?? null,
    writeFile: (path, text) => void files.set(path, text),
    rename: (from, to) => {
      files.set(to, files.get(from) ?? "");
      files.delete(from);
    },
  };
}

function depsFor(server: FakeServer, zalo: FakeZaloSession, sent: SentNotifications = memorySentNotifications()): NotificationDeps & { errors: string[] } {
  const errors: string[] = [];
  return {
    errors,
    api: internalApi({ baseUrl: BASE, token: TOKEN, fetch: server.fetch }),
    send: (target, key, values) => zalo.sendText(target, messageText(key, values)),
    sent,
    connected: () => zalo.connected(),
    onError: (event) => void errors.push(event),
  };
}

function start(server: FakeServer, sentNotifications?: SentNotifications) {
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
    random: () => 0,
    ...(sentNotifications ? { sentNotifications } : {}),
  });
  return { zalo, assistant };
}

describe("Story 6.4: notification outbox delivered by pull and acknowledgement (assistant)", () => {
  it("AC1: with two due rows the assistant takes one, sends it, acknowledges it, and only then gets the second", async () => {
    const server = fakeServer();
    const outbox = outboxServer(server, [notification(1), notification(2)]);
    const zalo = fakeZaloSession(systemClock);
    const deps = depsFor(server, zalo);
    expect(await deliverNext(deps)).toBe("sent");
    expect(zalo.sent.map((s) => s.target)).toEqual([{ kind: "private", userId: "70001" }]);
    expect([...outbox.acked]).toEqual([[1, "sent"]]);
    expect(server.calls.map((c) => c.path)).toEqual([NOTIFICATION_NEXT_PATH, "/internal/notifications/1/ack"]);
    expect(await deliverNext(deps)).toBe("sent");
    expect(zalo.sent.map((s) => s.target)).toEqual([{ kind: "private", userId: "70001" }, { kind: "private", userId: "70002" }]);
    expect(await deliverNext(deps)).toBe("idle");
    expect(zalo.sent[0]!.text).toBe(messageText("link_failed"));
  });

  it("AC1: one row at a time through the pacer: due rows go out with the human delay between them, never in one burst", async () => {
    const server = fakeServer();
    outboxServer(server, [1, 2, 3, 4].map((id) => notification(id)));
    const { zalo, assistant } = start(server);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(zalo.sent).toHaveLength(4);
    const at = zalo.sent.map((s) => toMs(s.at));
    for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(6_000);
    await assistant.stop();
  });

  it("AC3: a redelivered row whose key is in the local sent-notifications file is acknowledged without sending", async () => {
    const server = fakeServer();
    const outbox = outboxServer(server, [notification(1)]);
    const zalo = fakeZaloSession(systemClock);
    const sent = memorySentNotifications();
    sent.add(notification(1).dedupKey);
    expect(await deliverNext(depsFor(server, zalo, sent))).toBe("known");
    expect(zalo.sent).toEqual([]);
    expect([...outbox.acked]).toEqual([[1, "sent"]]);
  });

  it("exactly once: a lost ack after the send, then the row handed out again, is acknowledged and never sent twice", async () => {
    const server = fakeServer();
    const outbox = outboxServer(server, [notification(1)]);
    const zalo = fakeZaloSession(systemClock);
    const files = memoryFiles();
    const deps = depsFor(server, zalo, fileSentNotifications("/data", files, systemClock, () => undefined));
    outbox.ackFails = true;
    expect(await deliverNext(deps)).toBe("sent");
    expect(deps.errors).toEqual(["assistant.notification.ack_failed"]);
    expect(outbox.acked.size).toBe(0);
    // The lease runs out on the server and the row is handed out again.
    outbox.ackFails = false;
    outbox.releaseLeases();
    expect(await deliverNext(deps)).toBe("known");
    expect(zalo.sent).toHaveLength(1);
    expect(outbox.handouts).toBe(2);
    expect([...outbox.acked]).toEqual([[1, "sent"]]);
  });

  it("exactly once: a crash between the send and the ack, then a restart with the same data folder, never sends twice", async () => {
    const server = fakeServer();
    const outbox = outboxServer(server, [notification(1), notification(2)]);
    const zalo = fakeZaloSession(systemClock);
    const files = memoryFiles();
    // The first process sends row 1, records it, and dies before its ack reaches the server.
    outbox.ackFails = true;
    expect(await deliverNext(depsFor(server, zalo, fileSentNotifications("/data", files, systemClock, () => undefined)))).toBe("sent");
    expect(files.files.get(join("/data", SENT_NOTIFICATIONS_FILE))).toContain(notification(1).dedupKey);
    // A new process reads the file again; the server hands row 1 out again once its lease ran out.
    outbox.ackFails = false;
    outbox.releaseLeases();
    const restarted = depsFor(server, zalo, fileSentNotifications("/data", files, systemClock, () => undefined));
    expect(await deliverNext(restarted)).toBe("known");
    expect(await deliverNext(restarted)).toBe("sent");
    expect(zalo.sent.map((s) => s.target)).toEqual([{ kind: "private", userId: "70001" }, { kind: "private", userId: "70002" }]);
    expect([...outbox.acked]).toEqual([[1, "sent"], [2, "sent"]]);
  });

  it("a send that fails is not acknowledged nor recorded: the row comes back and is sent once", async () => {
    const server = fakeServer();
    const outbox = outboxServer(server, [notification(1)]);
    const zalo = fakeZaloSession(systemClock);
    let fail = true;
    const sent = memorySentNotifications();
    const deps = { ...depsFor(server, zalo, sent), send: async (...args: Parameters<NotificationDeps["send"]>) => (fail ? Promise.reject(new Error("zalo down")) : depsFor(server, zalo).send(...args)) };
    expect(await deliverNext(deps)).toBe("send_failed");
    expect(outbox.acked.size).toBe(0);
    expect(sent.keys.size).toBe(0);
    fail = false;
    outbox.releaseLeases();
    expect(await deliverNext(deps)).toBe("sent");
    expect(zalo.sent).toHaveLength(1);
  });

  it("a key the message file does not have is acknowledged undeliverable and never sent as a raw key", async () => {
    const server = fakeServer();
    const outbox = outboxServer(server, [notification(1, { messageKey: "campaign_slot_held" })]);
    const zalo = fakeZaloSession(systemClock);
    expect(await deliverNext(depsFor(server, zalo))).toBe("undeliverable");
    expect(zalo.sent).toEqual([]);
    expect([...outbox.acked]).toEqual([[1, "undeliverable"]]);
  });

  it("an amount parameter is written in dong; nothing is pulled while the Zalo session is down", async () => {
    const server = fakeServer();
    outboxServer(server, [notification(1, { dedupKey: "payout:P1:recorded", messageKey: "payout_recorded", params: { amount: 79_216, receiptToken: "tok123" } })]);
    const zalo = fakeZaloSession(systemClock);
    const deps = depsFor(server, zalo);
    await zalo.stop();
    expect(await deliverNext(deps)).toBe("down");
    expect(server.calls).toEqual([]);
    const open = { ...deps, connected: () => true };
    expect(await deliverNext(open)).toBe("sent");
    expect(zalo.sent[0]!.text).toBe(messageText("payout_recorded", { amount: "79.216\u0111", receiptToken: "tok123" }));
  });

  it("the sent-notifications file forgets keys older than 8 days and survives a corrupt file", () => {
    const files = memoryFiles();
    const warnings: string[] = [];
    const early = fileSentNotifications("/data", files, fixedClock("2026-11-01T00:00:00.000Z"), (e) => void warnings.push(e));
    early.add("order:A:approved");
    const later = fileSentNotifications("/data", files, fixedClock("2026-11-09T00:00:01.000Z"), (e) => void warnings.push(e));
    expect(later.has("order:A:approved")).toBe(true);
    later.add("order:B:approved");
    const reread = fileSentNotifications("/data", files, fixedClock("2026-11-09T00:00:02.000Z"), () => undefined);
    expect([reread.has("order:A:approved"), reread.has("order:B:approved")]).toEqual([false, true]);
    for (const [path] of files.files) files.files.set(path, "{not json");
    expect(fileSentNotifications("/data", files, systemClock, (e) => void warnings.push(e)).has("order:B:approved")).toBe(false);
    expect(warnings).toEqual(["assistant.sent_notifications.missing", "assistant.sent_notifications.unreadable"]);
  });
});

describe("Sprint 26 review: nothing is sent with a raw placeholder", () => {
  it("review 1: every message key renders completely with all its placeholders, and refuses to render with any one missing", () => {
    for (const key of Object.keys(messages) as MessageKey[]) {
      const names = placeholdersOf(key);
      const full = Object.fromEntries(names.map((n) => [n, "x"]));
      expect(messageText(key, full)).not.toMatch(/\{\w+\}/);
      for (const name of names) {
        const { [name]: _left, ...short } = full;
        expect(() => messageText(key, short)).toThrow(MessageIncompleteError);
      }
    }
  });

  it("review 1: a 'link ready' notification without its link is acknowledged undeliverable and never sent", async () => {
    const server = fakeServer();
    const outbox = outboxServer(server, [notification(1, { dedupKey: "link_request:26110100001:delivered", messageKey: "link_ready", params: { requestId: "26110100001" }, link: null })]);
    const zalo = fakeZaloSession(systemClock);
    expect(await deliverNext(depsFor(server, zalo))).toBe("undeliverable");
    expect(zalo.sent).toEqual([]);
    expect([...outbox.acked]).toEqual([[1, "undeliverable"]]);
  });

  it("review 1: a notification whose parameters leave a placeholder unfilled is undeliverable, never sent", async () => {
    const server = fakeServer();
    const outbox = outboxServer(server, [notification(1, { dedupKey: "payout:P1:recorded", messageKey: "payout_recorded", params: { amount: 79_216 } })]);
    const zalo = fakeZaloSession(systemClock);
    expect(await deliverNext(depsFor(server, zalo))).toBe("undeliverable");
    expect(zalo.sent).toEqual([]);
    expect([...outbox.acked]).toEqual([[1, "undeliverable"]]);
  });

  it("review 7: stopping the assistant aborts a pull in flight", async () => {
    const signals: AbortSignal[] = [];
    const fetch: FetchLike = (url, init) => {
      if (!url.endsWith(NOTIFICATION_NEXT_PATH)) return Promise.resolve({ status: 200, json: async () => ({ receivedAt: systemClock.now() }) });
      if (init.signal) signals.push(init.signal);
      return new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    };
    const zalo = fakeZaloSession(systemClock);
    const assistant = startAssistant({ zalo, api: internalApi({ baseUrl: BASE, token: TOKEN, fetch }), clock: systemClock, sleep: timerSleep, sendDelay: { minMs: 6_000, maxMs: 12_000 }, zaloGroupIds: [DEV_GROUP], friendRequestsPerDay: 30, onError: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    expect(signals).toHaveLength(1);
    expect(signals[0]!.aborted).toBe(false);
    await assistant.stop();
    expect(signals[0]!.aborted).toBe(true);
  });
});

describe("Story 6.5: link delivered once, by chat or by notification (assistant)", () => {
  const madeReply = replyOf("26110100001", { status: "ISSUED", shareUrl: SHARE, factsSettled: true, product: { name: "Ao thun", price: 150_000 }, estimate: { cashback: 12_345, shareBps: 8_000, withheld: true } });
  const LINK = "https://shopee.vn/Ao-thun-i.11001.22001";
  const known = (reused = false) => () => ok({ outcome: "queued", customerId: "70001", customerCode: "DP00001", registered: false, requestId: "26110100001", reused });

  async function replyTo(server: FakeServer, zaloSession?: FakeZaloSession, reply = madeReply) {
    server.routes[ASSISTANT_LINK_REPLY_PATH] = () => ok(reply);
    const zalo = zaloSession ?? fakeZaloSession(systemClock);
    const onError = vi.fn();
    const assistant = startAssistant({ zalo, api: internalApi({ baseUrl: BASE, token: TOKEN, fetch: server.fetch }), clock: systemClock, sleep: timerSleep, sendDelay: { minMs: 6_000, maxMs: 12_000 }, zaloGroupIds: [DEV_GROUP], friendRequestsPerDay: 30, onError, random: () => 0 });
    return { zalo, onError, assistant };
  }

  async function paste(zalo: FakeZaloSession): Promise<void> {
    const done = zalo.deliver({ chat: { kind: "private", userId: "70001" }, senderId: "70001", text: LINK });
    await vi.advanceTimersByTimeAsync(40_000);
    await done.catch(() => undefined);
  }

  it("a 'link ready' notification is written exactly as the chat reply would be, with the share link", async () => {
    const server = fakeServer();
    outboxServer(server, [notification(1, { dedupKey: "link_request:26110100001:delivered", messageKey: "link_ready", params: { requestId: "26110100001" }, link: madeReply })]);
    const zalo = fakeZaloSession(systemClock);
    expect(await deliverNext(depsFor(server, zalo))).toBe("sent");
    const { key, values } = linkReplyMessage({ ...madeReply, shareUrl: SHARE });
    expect(zalo.sent[0]!.text).toBe(messageText(key, values));
    expect(zalo.sent[0]!.text).toContain(SHARE);
  });

  it("AC2: the chat reply claims the link, sends it, and only then confirms it, so the server's 55 s check finds it handed over", async () => {
    const server = fakeServer();
    server.routes["/internal/assistant/link-requests"] = known();
    const { zalo, assistant } = await replyTo(server);
    await paste(zalo);
    const paths = server.calls.map((c) => c.path).filter((p) => p.includes("/link-replies/"));
    expect(paths).toEqual([ASSISTANT_LINK_CLAIM_PATH, ASSISTANT_LINK_CONFIRM_PATH]);
    expect(zalo.sent.map((s) => s.text)).toEqual([messageText(linkReplyMessage({ ...madeReply, shareUrl: SHARE }).key, linkReplyMessage({ ...madeReply, shareUrl: SHARE }).values)]);
    await assistant.stop();
  });

  it("review 5: a claim the server did not answer sends 'on its way' and no link; the notification delivers it once", async () => {
    const server = fakeServer();
    server.routes["/internal/assistant/link-requests"] = known();
    server.routes[ASSISTANT_LINK_CLAIM_PATH] = () => ({ status: 503, body: { error: { code: "unavailable", messageKey: "error.unavailable" } } });
    const { zalo, assistant } = await replyTo(server);
    await paste(zalo);
    expect(zalo.sent.map((s) => s.text)).toEqual([messageText("link_on_its_way")]);
    expect(server.callsTo(ASSISTANT_LINK_CONFIRM_PATH)).toEqual([]);
    await assistant.stop();
  });

  it("review 5: a link a notification is handing over ('pending') gets 'on its way' and no link, for a new request and for the same product asked again", async () => {
    for (const reused of [false, true]) {
      const server = fakeServer();
      server.routes["/internal/assistant/link-requests"] = known(reused);
      server.routes[ASSISTANT_LINK_CLAIM_PATH] = () => ok({ claim: "pending" });
      const { zalo, assistant } = await replyTo(server);
      await paste(zalo);
      expect(zalo.sent.map((s) => s.text)).toEqual([messageText("link_on_its_way")]);
      await assistant.stop();
    }
  });

  it("a new request whose link was already handed over gets no second link in the chat", async () => {
    const server = fakeServer();
    server.routes["/internal/assistant/link-requests"] = known(false);
    server.routes[ASSISTANT_LINK_CLAIM_PATH] = () => ok({ claim: "delivered" });
    const { zalo, assistant } = await replyTo(server);
    await paste(zalo);
    expect(zalo.sent).toEqual([]);
    await assistant.stop();
  });

  it("AC4: the same product asked again (the request reused, nothing pending) is answered in the chat with the link it already has", async () => {
    const server = fakeServer();
    server.routes["/internal/assistant/link-requests"] = known(true);
    server.routes[ASSISTANT_LINK_CLAIM_PATH] = () => ok({ claim: "delivered" });
    const { zalo, assistant } = await replyTo(server, undefined, { ...madeReply, status: "DELIVERED" });
    await paste(zalo);
    expect(zalo.sent).toHaveLength(1);
    expect(zalo.sent[0]!.text).toContain(SHARE);
    expect(server.callsTo(ASSISTANT_LINK_CONFIRM_PATH)).toEqual([]);
    await assistant.stop();
  });

  it("a claimed reply that could not be sent gives the link back, so it follows by notification instead of being lost", async () => {
    const server = fakeServer();
    server.routes["/internal/assistant/link-requests"] = known();
    const base = fakeZaloSession(systemClock);
    const failing: FakeZaloSession = { ...base, sendText: async () => Promise.reject(new Error("zalo down")) };
    const { onError, assistant } = await replyTo(server, failing);
    await paste(failing);
    expect(server.callsTo(ASSISTANT_LINK_RELEASE_PATH)).toEqual([{ requestId: "26110100001", customerId: "70001" }]);
    expect(server.callsTo(ASSISTANT_LINK_CONFIRM_PATH)).toEqual([]);
    expect(onError).toHaveBeenCalledWith("assistant.message.failed", expect.any(Error));
    await assistant.stop();
  });

  it("review: a reply that waits in the pacer queue for over 2 minutes claims its link only in its own turn, so the claim never lapses and the link goes out once", async () => {
    const server = fakeServer();
    server.routes["/internal/assistant/link-requests"] = known();
    // The server's lease: a claim lapses after 2 minutes, and then its delivery check would notify.
    const claims: number[] = [];
    server.routes[ASSISTANT_LINK_CLAIM_PATH] = () => (claims.push(toMs(systemClock.now())), ok({ claim: "claimed" }));
    const { zalo, assistant } = await replyTo(server);
    // 25 other sends ahead of the reply: at least 6 s apart, 150 s of queue.
    const busy = Array.from({ length: 25 }, (_, i) => assistant.send({ kind: "private", userId: `8000${i}` }, "send_a_link"));
    const pastedAt = toMs(systemClock.now());
    const done = zalo.deliver({ chat: { kind: "private", userId: "70001" }, senderId: "70001", text: LINK });
    await vi.advanceTimersByTimeAsync(400_000);
    await done;
    await Promise.all(busy);
    const linkSends = zalo.sent.filter((m) => m.text.includes(SHARE));
    expect(linkSends).toHaveLength(1);
    const sentAt = toMs(linkSends[0]!.at);
    expect(sentAt - pastedAt).toBeGreaterThan(2 * 60_000);
    expect(claims).toHaveLength(1);
    expect(sentAt - claims[0]!).toBeLessThan(5_000);
    expect(server.callsTo(ASSISTANT_LINK_CONFIRM_PATH)).toHaveLength(1);
    expect(zalo.sent.filter((m) => m.text === messageText("link_on_its_way"))).toEqual([]);
    await assistant.stop();
  });

  it("review: a claim taken in the reply's turn that says 'pending' sends 'on its way' in that same turn, no link", async () => {
    const server = fakeServer();
    server.routes["/internal/assistant/link-requests"] = known();
    server.routes[ASSISTANT_LINK_CLAIM_PATH] = () => ok({ claim: "pending" });
    const { zalo, assistant } = await replyTo(server);
    const busy = Array.from({ length: 25 }, (_, i) => assistant.send({ kind: "private", userId: `8000${i}` }, "send_a_link"));
    const done = zalo.deliver({ chat: { kind: "private", userId: "70001" }, senderId: "70001", text: LINK });
    await vi.advanceTimersByTimeAsync(400_000);
    await done;
    await Promise.all(busy);
    expect(zalo.sent.filter((m) => m.target.kind === "private" && m.target.userId === "70001").map((m) => m.text)).toEqual([messageText("link_on_its_way")]);
    await assistant.stop();
  });

  it("a confirm that fails is tried again; the reply itself is sent once", async () => {
    const server = fakeServer();
    server.routes["/internal/assistant/link-requests"] = known();
    let confirms = 0;
    server.routes[ASSISTANT_LINK_CONFIRM_PATH] = () => (++confirms < 2 ? { status: 503, body: {} } : ok({ confirmed: true }));
    const { zalo, assistant } = await replyTo(server);
    await paste(zalo);
    expect(confirms).toBe(2);
    expect(zalo.sent).toHaveLength(1);
    await assistant.stop();
  });
});
