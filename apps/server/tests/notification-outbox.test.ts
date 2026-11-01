/**
 * Story 6.4 (server side): the notification outbox handed out one row at a time on the internal
 * listener and acknowledged by the assistant (AD-15, AD-16, D5, D9, D46). The lease and its
 * back-off, the daily cap with its one owner alert, the 7-day drop, the guest refusal and the
 * exactly-once rules at the server. The assistant side (one at a time through the pacer, the
 * sent-notifications file) is in apps/assistant/tests/notifications.test.ts.
 */
import { NOTIFICATION_NEXT_PATH, notificationAckPath, type AssistantNotification } from "@cashback/contracts";
import { instantFromMs, toMs, vnDateOf } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";

import { droppedNotifications, dueAgainAfterMs, enqueue, handOutNext, redeliveryDelayMs, seedSentNotifications, sendsToday } from "../src/modules/messaging/index";
import { runNotificationExpiry } from "../src/notifications/notification-expiry.job";
import { alertsFor, commandAudit } from "../src/modules/operations/index";
import { notificationRoutes } from "../src/notifications/notification.routes";
import type { Ledger } from "../src/platform/db/ledger";
import { ASSISTANT_TOKEN_HEADER, INTERNAL_TOKEN_HEADER } from "../src/platform/http/internal-token.guard";
import { buildServers, close, type Servers } from "../src/platform/http/servers";
import { alertRows, C1, C2, LINK_START, linkLedger, movingClock } from "./helpers/link-ledger";

const INTERNAL = "i".repeat(40);
const ASSISTANT = "a".repeat(40);
const ACTOR = { kind: "system", id: "test" } as const;
const MINUTE = 60_000;

const ledgers: Ledger[] = [];
const opened: Servers[] = [];
afterEach(async () => {
  for (const s of opened.splice(0)) await close(s);
  for (const l of ledgers.splice(0)) l.close();
});

function setup(options: { dailyCap?: number; production?: boolean } = {}) {
  const ledger = linkLedger(ledgers);
  ledger.sqlite.exec(`UPDATE customers SET zalo_user_id = '70001' WHERE customer_id = '${C1}'; UPDATE customers SET zalo_user_id = '70002' WHERE customer_id = '${C2}';`);
  const clock = movingClock();
  const servers = buildServers({ clock, internalToken: INTERNAL, assistantToken: ASSISTANT, internal: [notificationRoutes({ ledger, clock, dailyCap: options.dailyCap ?? 150, shareBaseUrl: "https://hoantiendp.com", production: options.production ?? true })] });
  opened.push(servers);
  const next = async (): Promise<AssistantNotification | null> => {
    const answer = await servers.internalApp.inject({ method: "GET", url: NOTIFICATION_NEXT_PATH, headers: { [ASSISTANT_TOKEN_HEADER]: ASSISTANT } });
    expect(answer.statusCode).toBe(200);
    return (answer.json() as { notification: AssistantNotification | null }).notification;
  };
  const ack = async (id: number, result: "sent" | "undeliverable" = "sent") =>
    (await servers.internalApp.inject({ method: "POST", url: notificationAckPath(id), headers: { [ASSISTANT_TOKEN_HEADER]: ASSISTANT }, payload: { result } })).json() as { outcome: string };
  const add = (key: string, customerId = C1, messageKey = "link_failed") =>
    ledger.tx((db) => enqueue(db, clock, { dedupKey: key, customerId, messageKey, params: { requestId: key.split(":")[1] ?? "" } }, commandAudit(db, clock, ACTOR)));
  return { ledger, clock, servers, next, ack, add };
}

const row = (ledger: Ledger, key: string) => ledger.sqlite.prepare("SELECT due_at, sent_at, attempts, dropped_at, drop_reason FROM outbox WHERE dedup_key = ?").get(key) as { due_at: string | null; sent_at: string | null; attempts: number; dropped_at: string | null; drop_reason: string | null };

describe("Story 6.4: notification outbox delivered by pull and acknowledgement", () => {
  it("AC1: given two due rows, a pull gets one row; after its ack the next pull gives the second", async () => {
    const { next, ack, add } = setup();
    expect(add("link_request:R1:failed")).toBe("enqueued");
    expect(add("link_request:R2:failed", C2)).toBe("enqueued");
    const first = await next();
    expect(first).toMatchObject({ dedupKey: "link_request:R1:failed", zaloUserId: "70001", messageKey: "link_failed", params: { requestId: "R1" }, link: null });
    expect(await ack(first!.id)).toEqual({ id: first!.id, outcome: "sent" });
    const second = await next();
    expect(second).toMatchObject({ dedupKey: "link_request:R2:failed", zaloUserId: "70002" });
    expect(await ack(second!.id)).toMatchObject({ outcome: "sent" });
    expect(await next()).toBeNull();
  });

  it("AC1: a leased row is not handed out again while the assistant may still acknowledge it; the next row is", async () => {
    const { next, add } = setup();
    add("link_request:R1:failed");
    add("link_request:R2:failed");
    expect((await next())?.dedupKey).toBe("link_request:R1:failed");
    expect((await next())?.dedupKey).toBe("link_request:R2:failed");
    expect(await next()).toBeNull();
  });

  it("AC2: a row not acknowledged within 2 minutes is due again after 1, then 2, then 4 minutes, capped at 60 (fake clock)", async () => {
    const { ledger, clock, next, add } = setup();
    add("link_request:R1:failed");
    const waits: number[] = [];
    for (let handout = 1; handout <= 9; handout++) {
      const handedAt = toMs(clock.now());
      expect((await next())?.dedupKey).toBe("link_request:R1:failed");
      const dueAt = toMs(row(ledger, "link_request:R1:failed").due_at as never);
      waits.push((dueAt - handedAt - 2 * MINUTE) / MINUTE);
      clock.advance(dueAt - handedAt - 1);
      expect(await next()).toBeNull();
      clock.advance(1);
    }
    expect(waits).toEqual([1, 2, 4, 8, 16, 32, 60, 60, 60]);
    expect(row(ledger, "link_request:R1:failed").attempts).toBe(9);
    expect([redeliveryDelayMs(1), redeliveryDelayMs(3), redeliveryDelayMs(40), dueAgainAfterMs(1)]).toEqual([MINUTE, 4 * MINUTE, 60 * MINUTE, 3 * MINUTE]);
  });

  it("AC2: an ack that arrives after the lease ran out still records the send, and a second ack changes nothing", async () => {
    const { ledger, clock, next, ack, add } = setup();
    add("link_request:R1:failed");
    const first = await next();
    clock.advance(10 * MINUTE);
    expect(await ack(first!.id)).toMatchObject({ outcome: "sent" });
    expect(await ack(first!.id)).toMatchObject({ outcome: "already_sent" });
    expect(row(ledger, "link_request:R1:failed")).toMatchObject({ due_at: null, sent_at: instantFromMs(toMs(LINK_START as never) + 10 * MINUTE) });
    clock.advance(120 * MINUTE);
    expect(await next()).toBeNull();
  });

  it("AC3 (server side): a row handed out again after a lost ack is the same row, so the assistant's sent-notifications file can recognise it", async () => {
    const { clock, next, add } = setup();
    add("link_request:R1:failed");
    const first = await next();
    clock.advance(dueAgainAfterMs(1));
    const again = await next();
    expect(again).toEqual(first);
  });

  it("AC4: the 151st proactive send of a Vietnam day waits for the next day and one owner alert is raised", async () => {
    const { ledger, clock, next, ack, add } = setup();
    for (let i = 1; i <= 152; i++) add(`link_request:R${String(i).padStart(3, "0")}:failed`);
    for (let i = 1; i <= 150; i++) {
      const handed = await next();
      expect(handed).not.toBeNull();
      await ack(handed!.id);
    }
    expect(sendsToday(ledger.db, clock.now())).toBe(150);
    expect(await next()).toBeNull();
    clock.advance(MINUTE);
    expect(await next()).toBeNull();
    expect(alertRows(ledger).filter((a) => a.kind === "notification_daily_cap")).toEqual([{ kind: "notification_daily_cap", severity: "high", suppressed: 0 }]);
    // The next Vietnam day (LINK_START is 10:00 in Vietnam): the waiting rows go out again.
    const today = vnDateOf(clock.now());
    clock.advance(14 * 60 * MINUTE + 1);
    expect(vnDateOf(clock.now())).not.toBe(today);
    expect((await next())?.dedupKey).toBe("link_request:R151:failed");
    expect(alertRows(ledger).filter((a) => a.kind === "notification_daily_cap")).toHaveLength(1);
  });

  it("AC4: leased rows count toward the cap, so a burst of pulls cannot pass it", () => {
    const ledger = linkLedger(ledgers);
    ledger.sqlite.exec(`UPDATE customers SET zalo_user_id = '70001' WHERE customer_id = '${C1}'`);
    const clock = movingClock();
    const by = (db: Parameters<typeof commandAudit>[0]) => commandAudit(db, clock, ACTOR);
    ledger.tx((db) => ["a", "b", "c"].forEach((id) => enqueue(db, clock, { dedupKey: `link_request:${id}:failed`, customerId: C1, messageKey: "link_failed", params: {} }, by(db))));
    const kinds = [1, 2, 3].map(() => ledger.tx((db) => handOutNext(db, clock, { dailyCap: 2, alerts: alertsFor(db, clock) }).kind));
    expect(kinds).toEqual(["row", "row", "capped"]);
  });

  it("AC5: a row older than 7 days is never handed out; the expiry job drops and counts it; a guest enqueue is refused", async () => {
    const { ledger, clock, next, add } = setup();
    add("link_request:OLD:failed");
    clock.advance(7 * 24 * 60 * MINUTE + 1);
    add("link_request:NEW:failed");
    expect((await next())?.dedupKey).toBe("link_request:NEW:failed");
    expect(await next()).toBeNull();
    expect(runNotificationExpiry(ledger, clock)).toBe(1);
    expect(row(ledger, "link_request:OLD:failed")).toMatchObject({ sent_at: null, due_at: null, drop_reason: "expired" });
    expect(droppedNotifications(ledger.db)).toEqual({ expired: 1, no_recipient: 0, undeliverable: 0, superseded: 0 });
    expect(add("link_request:G1:failed", "HOUSE")).toBe("refused_guest");
    expect(ledger.tx((db) => enqueue(db, clock, { dedupKey: "payout:P1:recorded", customerId: C1, messageKey: "payout_recorded", params: {}, transferAmount: 0 }, commandAudit(db, clock, ACTOR)))).toBe("refused_netting_only");
  });

  it("review 4: a leased row is never dropped as expired, and an ack of a row dropped meanwhile records the send and clears the drop", async () => {
    const { ledger, clock, next, ack, add } = setup();
    add("link_request:R1:failed");
    clock.advance(7 * 24 * 60 * MINUTE - MINUTE);
    const handed = await next();
    clock.advance(MINUTE + 1);
    expect(runNotificationExpiry(ledger, clock)).toBe(0);
    expect(row(ledger, "link_request:R1:failed").drop_reason).toBeNull();
    // Once the lease ran out the row is dropped; the late ack still wins.
    clock.advance(2 * MINUTE);
    expect(runNotificationExpiry(ledger, clock)).toBe(1);
    expect(await ack(handed!.id)).toMatchObject({ outcome: "sent" });
    expect(row(ledger, "link_request:R1:failed")).toMatchObject({ dropped_at: null, drop_reason: null, due_at: null });
    expect(row(ledger, "link_request:R1:failed").sent_at).not.toBeNull();
  });

  it("Q2: a customer with no Zalo id whose customer id is a live Zalo uid is written to at that id; one with neither is dropped as no_recipient and counted", async () => {
    const { ledger, next, add } = setup();
    ledger.sqlite.exec(`UPDATE customers SET zalo_user_id = NULL WHERE customer_id IN ('${C1}', '${C2}')`);
    ledger.sqlite.exec("INSERT INTO customers (customer_id, customer_code, role, status) VALUES ('web42', 'DP00042', 'USER', 'ACTIVE')");
    add("link_request:R0:failed", "web42");
    add("link_request:R1:failed", C1);
    expect(await next()).toMatchObject({ dedupKey: "link_request:R1:failed", zaloUserId: C1 });
    expect(row(ledger, "link_request:R0:failed").drop_reason).toBe("no_recipient");
    expect(droppedNotifications(ledger.db).no_recipient).toBe(1);
  });

  it("review 6: the handout reads the oldest due row through its partial index", () => {
    const ledger = linkLedger(ledgers);
    const plan = ledger.sqlite
      .prepare("EXPLAIN QUERY PLAN SELECT * FROM outbox WHERE sent_at IS NULL AND dropped_at IS NULL AND due_at IS NOT NULL AND due_at <= ? AND created_at >= ? ORDER BY due_at, id LIMIT 1")
      .all("2026-11-01T00:00:00.000Z", "2026-10-25T00:00:00.000Z") as { detail: string }[];
    expect(plan.map((p) => p.detail).join(" ")).toContain("outbox_handout");
    const indexes = (ledger.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'outbox'").all() as { name: string }[]).map((i) => i.name);
    expect(indexes).toEqual(expect.arrayContaining(["outbox_handout", "outbox_leased"]));
  });

  it("an undeliverable ack drops the row and warns the owner once; it is never handed out again", async () => {
    const { ledger, clock, next, ack, add } = setup();
    add("campaign_award:A1:held", C1, "campaign_slot_held");
    const handed = await next();
    expect(await ack(handed!.id, "undeliverable")).toMatchObject({ outcome: "dropped" });
    clock.advance(120 * MINUTE);
    expect(await next()).toBeNull();
    expect(alertRows(ledger).map((a) => a.kind)).toEqual(["notification_undeliverable"]);
  });

  it("a dev ledger made by the cutover import hands out nothing: dev never messages a customer from production data", async () => {
    const { ledger, clock, next, add } = setup({ production: false });
    ledger.tx((db) => seedSentNotifications(db, [{ dedupKey: "order:O1:approved", customerId: C1, messageKey: "order_approved", sentAt: null }], clock.now(), commandAudit(db, clock, ACTOR)));
    add("link_request:R1:failed");
    expect(await next()).toBeNull();
    expect(row(ledger, "link_request:R1:failed").attempts).toBe(0);
  });

  it("the routes answer only the assistant token", async () => {
    const { servers } = setup();
    expect((await servers.internalApp.inject({ method: "GET", url: NOTIFICATION_NEXT_PATH, headers: { [INTERNAL_TOKEN_HEADER]: INTERNAL } })).statusCode).toBe(401);
    expect((await servers.internalApp.inject({ method: "POST", url: notificationAckPath(1), headers: { [ASSISTANT_TOKEN_HEADER]: ASSISTANT }, payload: { result: "sent" } })).statusCode).toBe(404);
    expect((await servers.internalApp.inject({ method: "POST", url: notificationAckPath(1), headers: { [ASSISTANT_TOKEN_HEADER]: ASSISTANT }, payload: { result: "maybe" } })).statusCode).toBe(400);
  });
});
