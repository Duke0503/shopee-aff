/**
 * Story 6.5: a made link reaches its customer once, by the chat reply or by one "link ready"
 * notification, and an old forgotten link not at all (FR-4, AD-14, AD-16). The delivery check is
 * run as the composition root runs it (links/link-jobs.ts), the chat claim, confirm and release
 * through the assistant's routes, and the notification through the outbox routes, so the link it
 * carries is the share link. A request is DELIVERED only once a channel actually handed it over.
 * The assistant side is in apps/assistant/tests/notifications.test.ts.
 */
import { ASSISTANT_LINK_CLAIM_PATH, ASSISTANT_LINK_CONFIRM_PATH, ASSISTANT_LINK_RELEASE_PATH, NOTIFICATION_NEXT_PATH, notificationAckPath, type AssistantNotification } from "@cashback/contracts";
import { fixedClock } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";

import { assistantChatRoutes } from "../src/links/assistant-chat.routes";
import { runLinkDeliveryCheck } from "../src/links/link-jobs";
import { fakeBridge, LINK_CLAIM_MS, LINK_REPLY_WAIT_MS, LINK_STALE_AFTER_MS, queueLinkRequest } from "../src/modules/linking/index";
import { setSilent } from "../src/modules/messaging/index";
import { commandAudit } from "../src/modules/operations/index";
import { notificationRoutes } from "../src/notifications/notification.routes";
import type { Ledger } from "../src/platform/db/ledger";
import { ASSISTANT_TOKEN_HEADER } from "../src/platform/http/internal-token.guard";
import { buildServers, close, type Servers } from "../src/platform/http/servers";
import { alertRows, C1, C2, linkLedger, movingClock, queueLink, runLinks, SHOPEE_PRODUCT } from "./helpers/link-ledger";

const INTERNAL = "i".repeat(40);
const ASSISTANT = "a".repeat(40);
const SECOND = 1_000;
const MINUTE = 60 * SECOND;

const ledgers: Ledger[] = [];
const opened: Servers[] = [];
afterEach(async () => {
  for (const s of opened.splice(0)) await close(s);
  for (const l of ledgers.splice(0)) l.close();
});

/** A ledger with one ISSUED link of `customer`, requested at LINK_START, and the clock at that time. */
async function issued(customer = C1) {
  const ledger = linkLedger(ledgers);
  ledger.sqlite.exec(`UPDATE customers SET zalo_user_id = '70001' WHERE customer_id = '${C1}'`);
  const requestId = queueLink(ledger, customer);
  await runLinks(ledger, fakeBridge());
  const clock = movingClock();
  const servers = buildServers({
    clock,
    internalToken: INTERNAL,
    assistantToken: ASSISTANT,
    internal: [
      assistantChatRoutes({ ledger, clock, requestIdPrefix: "", tikTok: true, shareBaseUrl: "https://hoantiendp.com" }),
      notificationRoutes({ ledger, clock, dailyCap: 150, shareBaseUrl: "https://hoantiendp.com", production: true }),
    ],
  });
  opened.push(servers);
  const headers = { [ASSISTANT_TOKEN_HEADER]: ASSISTANT };
  const post = async (url: string, payload: object) => servers.internalApp.inject({ method: "POST", url, headers, payload });
  const next = async () => ((await servers.internalApp.inject({ method: "GET", url: NOTIFICATION_NEXT_PATH, headers })).json() as { notification: AssistantNotification | null }).notification;
  const ack = async (id: number, result: "sent" | "undeliverable" = "sent") => (await post(notificationAckPath(id), { result })).json() as { outcome: string };
  const claim = async (customerId = C1) => (await post(ASSISTANT_LINK_CLAIM_PATH, { requestId, customerId })).json() as { claim: string };
  const check = () => runLinkDeliveryCheck(ledger, clock);
  const request = () => ledger.sqlite.prepare("SELECT status, delivered_at, delivery_attempt FROM link_requests WHERE request_id = ?").get(requestId) as { status: string; delivered_at: string | null; delivery_attempt: number };
  const notes = () => ledger.sqlite.prepare("SELECT dedup_key, message_key, due_at IS NOT NULL AS due, silenced_at IS NOT NULL AS silenced, sent_at IS NOT NULL AS sent, drop_reason FROM outbox ORDER BY id").all();
  const quiet = (silent: boolean) => ledger.tx((db) => setSilent(db, silent, clock.now(), commandAudit(db, clock, { kind: "system", id: "test" })));
  return { ledger, clock, requestId, post, next, ack, claim, check, request, notes, quiet };
}

describe("Story 6.5: link delivered once, by chat or by notification", () => {
  it("AC1: an ISSUED link not handed over after 55 s gets one 'link ready' notification with key link_request:<id>:delivered; it is DELIVERED once that is sent", async () => {
    const { clock, requestId, check, request, notes, next, ack } = await issued();
    clock.advance(LINK_REPLY_WAIT_MS - SECOND);
    expect(check()).toEqual({ notified: 0, closed: 0 });
    clock.advance(SECOND);
    expect(check()).toEqual({ notified: 1, closed: 0 });
    expect(notes()).toEqual([{ dedup_key: `link_request:${requestId}:delivered`, message_key: "link_ready", due: 1, silenced: 0, sent: 0, drop_reason: null }]);
    expect(request()).toMatchObject({ status: "ISSUED", delivered_at: null });
    clock.advance(30 * SECOND);
    expect(check()).toEqual({ notified: 0, closed: 0 });
    const handed = await next();
    expect(await ack(handed!.id)).toMatchObject({ outcome: "sent" });
    expect(request()).toMatchObject({ status: "DELIVERED", delivered_at: clock.now() });
    clock.advance(60 * SECOND);
    expect(check()).toEqual({ notified: 0, closed: 0 });
    expect(notes()).toHaveLength(1);
  });

  it("AC1: the notification carries the share link and the reply facts, never the affiliate link", async () => {
    const { ledger, clock, requestId, check, next } = await issued();
    clock.advance(LINK_REPLY_WAIT_MS);
    check();
    const notification = await next();
    expect(notification).toMatchObject({ dedupKey: `link_request:${requestId}:delivered`, zaloUserId: "70001", messageKey: "link_ready", link: { requestId, status: "ISSUED" } });
    expect(notification?.link?.shareUrl).toMatch(/^https:\/\/hoantiendp\.com\/s\/[A-Za-z0-9]{10}$/);
    const affiliate = (ledger.sqlite.prepare("SELECT affiliate_url FROM link_requests WHERE request_id = ?").get(requestId) as { affiliate_url: string }).affiliate_url;
    expect(JSON.stringify(notification)).not.toContain(affiliate);
  });

  it("AC2: given the reply claimed, sent and confirmed the link, the 55 s check enqueues no notification", async () => {
    const { clock, requestId, post, claim, check, request, notes } = await issued();
    clock.advance(20 * SECOND);
    expect(await claim()).toEqual({ claim: "claimed" });
    // While the claim holds, the check leaves the link to the reply, and a second claim waits.
    clock.advance(LINK_REPLY_WAIT_MS);
    expect(check()).toEqual({ notified: 0, closed: 0 });
    expect(await claim()).toEqual({ claim: "pending" });
    expect((await post(ASSISTANT_LINK_CONFIRM_PATH, { requestId, customerId: C1 })).json()).toEqual({ confirmed: true });
    expect(request()).toMatchObject({ status: "DELIVERED", delivered_at: clock.now() });
    clock.advance(LINK_CLAIM_MS + MINUTE);
    expect(check()).toEqual({ notified: 0, closed: 0 });
    expect(notes()).toEqual([]);
    expect(await claim()).toEqual({ claim: "delivered" });
  });

  it("review 3: a reply claimed and not sent releases the link: it stays ISSUED and the next check delivers it by notification, once", async () => {
    const { clock, requestId, post, claim, check, request, notes, next, ack } = await issued();
    clock.advance(20 * SECOND);
    await claim();
    expect((await post(ASSISTANT_LINK_RELEASE_PATH, { requestId, customerId: C1 })).json()).toEqual({ released: true });
    expect(request()).toMatchObject({ status: "ISSUED", delivered_at: null });
    clock.advance(LINK_REPLY_WAIT_MS);
    expect(check()).toEqual({ notified: 1, closed: 0 });
    expect(await claim()).toEqual({ claim: "pending" });
    expect((await post(ASSISTANT_LINK_RELEASE_PATH, { requestId, customerId: C1 })).json()).toEqual({ released: false });
    await ack((await next())!.id);
    expect(request().status).toBe("DELIVERED");
    expect(notes()).toHaveLength(1);
  });

  it("review A: the assistant stops after its claim and never confirms: the claim lapses and the link is delivered by notification exactly once", async () => {
    const { clock, claim, check, request, notes, next, ack } = await issued();
    clock.advance(20 * SECOND);
    expect(await claim()).toEqual({ claim: "claimed" });
    clock.advance(LINK_CLAIM_MS - 20 * SECOND);
    expect(check()).toEqual({ notified: 0, closed: 0 });
    clock.advance(20 * SECOND);
    expect(check()).toEqual({ notified: 1, closed: 0 });
    expect(check()).toEqual({ notified: 0, closed: 0 });
    const handed = await next();
    await ack(handed!.id);
    expect(request()).toMatchObject({ status: "DELIVERED" });
    clock.advance(10 * MINUTE);
    expect(check()).toEqual({ notified: 0, closed: 0 });
    expect(await next()).toBeNull();
    expect(notes()).toEqual([expect.objectContaining({ sent: 1 })]);
  });

  it("review A: a confirm that arrives after its claim lapsed withdraws the notification not yet handed out, so the link is told once", async () => {
    const { clock, requestId, post, claim, check, notes, next } = await issued();
    await claim();
    clock.advance(LINK_CLAIM_MS + SECOND);
    check();
    expect((await post(ASSISTANT_LINK_CONFIRM_PATH, { requestId, customerId: C1 })).json()).toEqual({ confirmed: true });
    expect(notes()).toEqual([expect.objectContaining({ due: 0, sent: 0, drop_reason: "superseded" })]);
    expect(await next()).toBeNull();
  });

  it("AC2: a link of another customer cannot be claimed, and a link not made yet is not", async () => {
    const { ledger, requestId, post } = await issued();
    expect((await post(ASSISTANT_LINK_CLAIM_PATH, { requestId, customerId: C2 })).statusCode).toBe(404);
    expect((await post(ASSISTANT_LINK_CONFIRM_PATH, { requestId, customerId: C2 })).statusCode).toBe(404);
    const queued = queueLink(ledger, C2, "https://shopee.vn/Quan-i.11001.99999");
    expect((await post(ASSISTANT_LINK_CLAIM_PATH, { requestId: queued, customerId: C2 })).json()).toEqual({ claim: "not_made" });
  });

  it("review 2: while messaging.silent is on the link stays ISSUED as a would-be send; once it is off the next check sends it under a new key", async () => {
    const { clock, requestId, check, request, notes, quiet, next, ack } = await issued();
    quiet(true);
    clock.advance(LINK_REPLY_WAIT_MS);
    check();
    expect(request()).toMatchObject({ status: "ISSUED", delivery_attempt: 0 });
    expect(notes()).toEqual([expect.objectContaining({ dedup_key: `link_request:${requestId}:delivered`, due: 0, silenced: 1 })]);
    clock.advance(MINUTE);
    expect(check()).toEqual({ notified: 0, closed: 0 });
    expect(notes()).toHaveLength(1);
    quiet(false);
    expect(check()).toEqual({ notified: 1, closed: 0 });
    expect(notes()).toEqual([expect.objectContaining({ silenced: 1, due: 0 }), expect.objectContaining({ dedup_key: `link_request:${requestId}.1:delivered`, due: 1, silenced: 0 })]);
    const handed = await next();
    expect(handed?.link?.requestId).toBe(requestId);
    await ack(handed!.id);
    expect(request()).toMatchObject({ status: "DELIVERED", delivery_attempt: 1 });
  });

  it("review 2: a dropped notification is never a silent loss: told again, then closed with a warning", async () => {
    const { ledger, clock, requestId, check, request, notes, next, ack } = await issued();
    clock.advance(LINK_REPLY_WAIT_MS);
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(check()).toEqual({ notified: 1, closed: 0 });
      const handed = await next();
      expect(handed?.dedupKey).toBe(attempt === 0 ? `link_request:${requestId}:delivered` : `link_request:${requestId}.${attempt}:delivered`);
      // The assistant has no complete text for it: undeliverable, dropped.
      expect(await ack(handed!.id, "undeliverable")).toMatchObject({ outcome: "dropped" });
      expect(request().status).toBe("ISSUED");
    }
    expect(check()).toEqual({ notified: 0, closed: 1 });
    expect(request()).toMatchObject({ status: "DELIVERED", delivered_at: null });
    expect(notes()).toHaveLength(3);
    expect(alertRows(ledger).map((r) => r.kind)).toContain("link_undeliverable");
  });

  it("AC3: an undelivered link older than 2 hours is marked DELIVERED with no message", async () => {
    const { clock, check, request, notes } = await issued();
    clock.advance(LINK_STALE_AFTER_MS + SECOND);
    expect(check()).toEqual({ notified: 0, closed: 1 });
    expect(request()).toMatchObject({ status: "DELIVERED", delivered_at: null });
    expect(notes()).toEqual([]);
  });

  it("AC3: exactly 2 hours old is still told; a guest's link is closed without a message whatever its age", async () => {
    const told = await issued();
    told.clock.advance(LINK_STALE_AFTER_MS);
    expect(told.check()).toEqual({ notified: 1, closed: 0 });
    const guest = await issued("HOUSE");
    guest.clock.advance(LINK_REPLY_WAIT_MS);
    expect(guest.check()).toEqual({ notified: 0, closed: 1 });
    expect(guest.notes()).toEqual([]);
  });

  it("AC4: given the link delivered by notification, the same product asked again reuses the link and no second notification is sent", async () => {
    const { ledger, clock, requestId, check, notes, next, ack, claim } = await issued();
    clock.advance(LINK_REPLY_WAIT_MS);
    check();
    await ack((await next())!.id);
    clock.advance(10 * MINUTE);
    const again = ledger.tx((db) => queueLinkRequest(db, { customer: C1, url: SHOPEE_PRODUCT, channel: "zalo" }, fixedClock(clock.now())));
    expect(again).toMatchObject({ requestId, reused: true, status: "DELIVERED" });
    expect(await claim()).toEqual({ claim: "delivered" });
    clock.advance(LINK_REPLY_WAIT_MS);
    expect(check()).toEqual({ notified: 0, closed: 0 });
    expect(notes()).toHaveLength(1);
    expect(alertRows(ledger)).toEqual([]);
  });
});
