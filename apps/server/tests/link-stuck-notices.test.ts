/**
 * D65 (server side): why a Shopee link is stuck. A captcha alert names the step that found it, each
 * stuck request sends the owner one message with the customer's name and id, and the link reply says
 * the queue is stopped. A page error hold says none of this. The assistant side is in
 * apps/assistant/tests/link-queue-stopped.test.ts. Telegram is always a fake sender here.
 */
import { ASSISTANT_LINK_REPLY_PATH, NOTIFICATION_NEXT_PATH, notificationAckPath, type AssistantNotification } from "@cashback/contracts";
import { instantFromMs, toMs } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";

import { healthSourcesFor, ownerJobs } from "../src/health/owner-jobs";
import { assistantChatRoutes } from "../src/links/assistant-chat.routes";
import { linkEffectsFor, runLinkDeliveryCheck } from "../src/links/link-jobs";
import { CAPTCHA_HOLD_MS, fakeBridge, holdShopeeQueue, LINK_STALE_AFTER_MS, pauseShopeeQueue, PAGE_ERROR_HOLD_MS, queuedShopeeRequests, readShopeePayouts, recordLookupResult, resumeShopeeQueue, shopeeBridgeSource, shopeeQueueStopReason } from "../src/modules/linking/index";
import { alertsFor, assistantHeartbeats, commandAudit, deliverPendingAlerts, healthCheck, ledgerAlerts, parseAlertDetail, raiseStuckRequestAlerts, readHealthModel, telegramText, type AlertSender } from "../src/modules/operations/index";
import { notificationRoutes } from "../src/notifications/notification.routes";
import type { Ledger } from "../src/platform/db/ledger";
import { ASSISTANT_TOKEN_HEADER } from "../src/platform/http/internal-token.guard";
import { buildServers, close, type Servers } from "../src/platform/http/servers";
import { answeringBridge, C1, C2, LINK_START, linkLedger, memoryLogger, movingClock, outboxRows, queueLink, runLinks, SHOPEE_PRODUCT, SILENT } from "./helpers/link-ledger";
import { tempDir } from "./helpers/live-fixture";

const ledgers: Ledger[] = [];
const opened: Servers[] = [];
afterEach(async () => {
  for (const s of opened.splice(0)) await close(s);
  for (const l of ledgers.splice(0)) l.close();
});

const NAME = "Nguyen Van <An>";
const TIKTOK = "https://www.tiktok.com/@shop/video/7300000000000000000";

function fixture() {
  const ledger = linkLedger(ledgers);
  ledger.sqlite.prepare("UPDATE customers SET display_name = ? WHERE customer_id = ?").run(NAME, C1);
  const clock = movingClock();
  const sent: string[] = [];
  const sender: AlertSender = { send: async (text) => void sent.push(text) };
  const deliver = () => deliverPendingAlerts(ledger, sender, clock, SILENT);
  const held = () => instantFromMs(toMs(clock.now()) + CAPTCHA_HOLD_MS);
  return { ledger, clock, sent, sender, deliver, held };
}

const INTERNAL = "i".repeat(40);
const ASSISTANT = "a".repeat(40);

/** The assistant's routes over a fixture's ledger: the link reply and the notification hand-over. */
function routesFor(f: ReturnType<typeof fixture>) {
  const { ledger, clock } = f;
  const shareBaseUrl = "https://hoantiendp.com/";
  const servers = buildServers({ clock, internalToken: INTERNAL, assistantToken: ASSISTANT, internal: [assistantChatRoutes({ ledger, clock, requestIdPrefix: "", tikTok: true, shareBaseUrl }), notificationRoutes({ ledger, clock, dailyCap: 150, shareBaseUrl, production: true })] });
  opened.push(servers);
  const headers = { [ASSISTANT_TOKEN_HEADER]: ASSISTANT };
  const reply = async (requestId: string, customerId = C1) => (await servers.internalApp.inject({ method: "POST", url: ASSISTANT_LINK_REPLY_PATH, headers, payload: { requestId, customerId } })).json() as { queueStopped?: boolean; shareUrl: string | null };
  const next = async () => ((await servers.internalApp.inject({ method: "GET", url: NOTIFICATION_NEXT_PATH, headers })).json() as { notification: AssistantNotification | null }).notification;
  const ack = async (id: number) => servers.internalApp.inject({ method: "POST", url: notificationAckPath(id), headers, payload: { result: "sent" } });
  return { reply, next, ack };
}

const requestRow = (ledger: Ledger, requestId: string) => ledger.sqlite.prepare("SELECT status, delivered_at AS deliveredAt FROM link_requests WHERE request_id = ?").get(requestId) as { status: string; deliveredAt: string | null };

const stuckRows = (ledger: Ledger) => ledger.sqlite.prepare("SELECT kind, dedup_key AS dedupKey, detail FROM alerts WHERE kind = 'link_request_stuck' ORDER BY id").all() as { kind: string; dedupKey: string; detail: string }[];

describe("when the queue counts as stopped", () => {
  it("a captcha hold and a lost login do; an open queue, an ended hold and a page error hold do not", () => {
    const { ledger, clock, held } = fixture();
    const reason = () => ledger.tx((db) => shopeeQueueStopReason(db, clock.now()));
    expect(reason()).toBeNull();
    ledger.tx((db) => holdShopeeQueue(db, "page_error", instantFromMs(toMs(clock.now()) + PAGE_ERROR_HOLD_MS)));
    expect(reason()).toBeNull();
    ledger.tx((db) => holdShopeeQueue(db, "captcha", held()));
    expect(reason()).toBe("captcha");
    clock.advance(CAPTCHA_HOLD_MS + 1);
    expect(reason()).toBeNull();
    ledger.tx((db) => pauseShopeeQueue(db, "login_redirect", clock.now()));
    expect(reason()).toBe("login_lost");
  });
});

describe("a captcha alert names the step that found it", () => {
  it("on a link request: the customer's name (escaped), id and product", async () => {
    const f = fixture();
    const requestId = queueLink(f.ledger, C1);
    await runLinks(f.ledger, answeringBridge(() => ({ outcome: "failed", reason: "captcha" })), { clock: f.clock });
    await f.deliver();
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]).toContain("t\u1ea1o link cho kh\u00e1ch");
    expect(f.sent[0]).toContain(`Nguyen Van &lt;An&gt; (ID: ${C1})`);
    expect(f.sent[0]).toContain("shopee.vn/product/11001/22001");
    expect(f.sent[0]).not.toContain("<An>");
    const row = f.ledger.sqlite.prepare("SELECT detail FROM alerts").get() as { detail: string };
    expect(parseAlertDetail(row.detail)).toEqual({ source: "link_request", requestId });
    expect(row.detail).not.toContain("Nguyen");
  });

  it("an erased customer is the id alone, and an unknown request its own id", async () => {
    const f = fixture();
    queueLink(f.ledger, C1);
    await runLinks(f.ledger, answeringBridge(() => ({ outcome: "failed", reason: "captcha" })), { clock: f.clock });
    f.ledger.sqlite.prepare("UPDATE customers SET status = 'ERASED', erased_at = ?, display_name = NULL WHERE customer_id = ?").run(LINK_START, C1);
    await f.deliver();
    expect(f.sent[0]).toContain(`Kh\u00e1ch ID: ${C1}`);
    expect(f.sent[0]).not.toContain("Nguyen");
    expect(f.sent[0]).not.toContain("S\u1ea3n ph\u1ea9m:");
    const g = fixture();
    ledgerAlerts(g.ledger, g.clock).alert("bridge_captcha", "high", { source: "link_request", requestId: "GONE1" });
    await g.deliver();
    expect(g.sent[0]).toContain("Kh\u00e1ch ID: GONE1");
  });

  it("a name changed before a retry is read again at send time", async () => {
    const f = fixture();
    queueLink(f.ledger, C1);
    await runLinks(f.ledger, answeringBridge(() => ({ outcome: "failed", reason: "captcha" })), { clock: f.clock });
    await deliverPendingAlerts(f.ledger, { send: () => Promise.reject(new Error("offline")) }, f.clock, SILENT);
    f.ledger.sqlite.prepare("UPDATE customers SET display_name = 'Tran Binh' WHERE customer_id = ?").run(C1);
    await f.deliver();
    expect(f.sent[0]).toContain("Tran Binh");
    expect(f.sent[0]).not.toContain("Nguyen");
  });

  const captchaBridge = { mode: "browser" as const, createLink: async () => ({ outcome: "failed" as const, reason: "unused" }), readReportPage: async () => ({ outcome: "failed" as const, reason: "captcha" }), readPayoutRecords: async () => ({ outcome: "failed" as const, reason: "captcha" }) };

  it.each([
    ["the conversion report", "b\u00e1o c\u00e1o chuy\u1ec3n \u0111\u1ed5i"],
    ["the payout record", "trang thanh to\u00e1n"],
  ] as const)("AC: at %s it names that step and no customer", async (step, words) => {
    const f = fixture();
    queueLink(f.ledger, C1);
    const deps = { bridge: captchaBridge, ledger: f.ledger, clock: f.clock, alerts: (db: Parameters<typeof alertsFor>[0]) => alertsFor(db, f.clock) };
    const read = step === "the payout record" ? readShopeePayouts(deps, new AbortController().signal) : shopeeBridgeSource({ ...deps, wait: async () => undefined, yieldMaxMs: 0 }).read({ since: f.clock.now(), until: f.clock.now() });
    await expect(read).rejects.toThrow();
    await f.deliver();
    expect(f.sent[0]).toContain(words);
    expect(f.sent[0]).not.toContain(C1);
    expect(f.sent[0]).not.toContain("Nguyen");
    expect(f.sent[0]).not.toContain("t\u1ea1o link cho kh\u00e1ch");
  });

  it("at a product lookup it names that step and no customer", async () => {
    const f = fixture();
    const requestId = queueLink(f.ledger, C1);
    f.ledger.sqlite.prepare("INSERT INTO bridge_jobs (kind, status, request_id, source_url, created_at) VALUES ('LOOKUP', 'PENDING', ?, 'https://shopee.vn/x', ?)").run(requestId, LINK_START);
    const jobId = (f.ledger.sqlite.prepare("SELECT job_id AS id FROM bridge_jobs").get() as { id: number }).id;
    f.ledger.tx((db) => recordLookupResult(db, { jobId, requestId, url: "https://shopee.vn/x" }, { outcome: "failed", reason: "captcha" }, f.clock, linkEffectsFor(f.clock)));
    await f.deliver();
    expect(f.sent[0]).toContain("tra c\u1ee9u th\u00f4ng tin s\u1ea3n ph\u1ea9m");
    expect(f.sent[0]).not.toContain(C1);
  });

  it("found by the health check it says so, and the first detail of a cooldown is kept", async () => {
    const f = fixture();
    const check = healthCheck({ model: () => readHealthModel(f.ledger, f.clock, {}), alerts: ledgerAlerts(f.ledger, f.clock), clock: f.clock });
    f.ledger.tx((db) => holdShopeeQueue(db, "captcha", f.held()));
    check.run();
    ledgerAlerts(f.ledger, f.clock).alert("bridge_captcha", "high", { source: "conversion_report" });
    expect(f.ledger.sqlite.prepare("SELECT detail, suppressed FROM alerts").all()).toEqual([{ detail: '{"source":"health_check"}', suppressed: 1 }]);
    await f.deliver();
    expect(f.sent[0]).toContain("ki\u1ec3m tra s\u1ee9c kh\u1ecfe");
  });

  it("the health check's detail changes no other kind's words, and a bad stored detail is no detail", () => {
    const at = LINK_START;
    const plain = { kind: "bridge_login_lost", severity: "critical" as const, suppressed: 0, raisedAt: at };
    expect(telegramText({ ...plain, detail: { source: "health_check" } })).toBe(telegramText(plain));
    expect(parseAlertDetail(null)).toBeNull();
    expect(parseAlertDetail("not json")).toBeNull();
    expect(parseAlertDetail('{"source":"Nguyen Van An"}')).toBeNull();
  });

  it("refuses free text in a detail", () => {
    const f = fixture();
    expect(() => ledgerAlerts(f.ledger, f.clock).alert("bridge_captcha", "high", { source: "Nguyen" as "captcha" })).toThrow(RangeError);
    expect(() => ledgerAlerts(f.ledger, f.clock).alert("bridge_captcha", "high", { source: "link_request", requestId: "Nguyen Van" })).toThrow(RangeError);
  });
});

describe("one owner message per stuck request", () => {
  const raise = (f: ReturnType<typeof fixture>) => raiseStuckRequestAlerts(f.ledger, f.clock, SILENT);

  it("while a captcha holds the queue: name, id, product and reason, once, past the kind's cooldown", async () => {
    const f = fixture();
    const first = queueLink(f.ledger, C1);
    const second = queueLink(f.ledger, C2, "https://shopee.vn/Noi-com-i.11001.22002");
    f.ledger.tx((db) => holdShopeeQueue(db, "captcha", f.held()));
    expect(raise(f)).toBe(2);
    expect(raise(f)).toBe(0);
    expect(stuckRows(f.ledger).map((r) => r.dedupKey)).toEqual([`link_request_stuck:${first}`, `link_request_stuck:${second}`]);
    await f.deliver();
    expect(f.sent).toHaveLength(2);
    expect(f.sent[0]).toContain(`Nguyen Van &lt;An&gt; (ID: ${C1})`);
    expect(f.sent[0]).toContain("shopee.vn/product/11001/22001");
    expect(f.sent[0]).toContain("Captcha");
    expect(f.sent[1]).toContain(`Kh\u00e1ch ID: ${C2}`);
    expect(raise(f)).toBe(0);
    await f.deliver();
    expect(f.sent).toHaveLength(2);
  });

  it("a later request is told, a second stop repeats nobody, and a lost login says so", async () => {
    const f = fixture();
    const clock = f.clock;
    queueLink(f.ledger, C1);
    f.ledger.tx((db) => holdShopeeQueue(db, "captcha", f.held()));
    expect(raise(f)).toBe(1);
    clock.advance(CAPTCHA_HOLD_MS + 1);
    expect(raise(f)).toBe(0);
    f.ledger.tx((db) => pauseShopeeQueue(db, "login_redirect", clock.now()));
    expect(raise(f)).toBe(0);
    queueLink(f.ledger, C2, "https://shopee.vn/Noi-com-i.11001.22002", clock);
    expect(raise(f)).toBe(1);
    await f.deliver();
    expect(f.sent[1]).toContain("m\u1ea5t phi\u00ean \u0111\u0103ng nh\u1eadp");
  });

  it("a page error hold, an open queue and a TikTok Shop request send none", () => {
    const f = fixture();
    queueLink(f.ledger, C1);
    expect(raise(f)).toBe(0);
    f.ledger.tx((db) => holdShopeeQueue(db, "page_error", instantFromMs(toMs(f.clock.now()) + PAGE_ERROR_HOLD_MS)));
    expect(raise(f)).toBe(0);
    const g = fixture();
    queueLink(g.ledger, C1, TIKTOK);
    g.ledger.tx((db) => holdShopeeQueue(db, "captcha", g.held()));
    expect(g.ledger.tx((db) => queuedShopeeRequests(db))).toEqual([]);
    expect(raise(g)).toBe(0);
  });

  it("the row and the log line carry ids and kinds only", () => {
    const f = fixture();
    const requestId = queueLink(f.ledger, C1);
    f.ledger.tx((db) => holdShopeeQueue(db, "captcha", f.held()));
    const { logger, lines } = memoryLogger();
    raiseStuckRequestAlerts(f.ledger, f.clock, logger);
    expect(stuckRows(f.ledger)[0]?.detail).toBe(JSON.stringify({ source: "captcha", requestId }));
    expect(lines.join("\n")).toContain("link_request_stuck");
    expect(lines.join("\n")).not.toContain("Nguyen");
    expect(lines.join("\n")).not.toContain("shopee.vn");
  });

  it("Telegram down: retried, and expired after 24 hours like any alert", async () => {
    const f = fixture();
    queueLink(f.ledger, C1);
    f.ledger.tx((db) => holdShopeeQueue(db, "captcha", f.held()));
    raise(f);
    await deliverPendingAlerts(f.ledger, { send: () => Promise.reject(new Error("offline")) }, f.clock, SILENT);
    expect(f.ledger.sqlite.prepare("SELECT delivery, attempts FROM alerts WHERE kind = 'link_request_stuck'").get()).toEqual({ delivery: "PENDING", attempts: 1 });
    f.clock.advance(24 * 3_600_000 + 1);
    await f.deliver();
    expect(f.sent).toEqual([]);
    f.ledger.tx((db) => holdShopeeQueue(db, "captcha", f.held()));
    expect(raise(f)).toBe(0);
  });

  it("the job ownerJobs starts raises one row when run, with or without Telegram", async () => {
    const heartbeats = assistantHeartbeats(null);
    for (const telegram of [null, { botToken: "123456789:FAKE-test-token-never-real", chatId: "-100200300400" }]) {
      const f = fixture();
      queueLink(f.ledger, C1);
      f.ledger.tx((db) => holdShopeeQueue(db, "captcha", f.held()));
      const config = { env: "prod" as const, dataDir: tempDir("cashback-stuck-"), telegram, backupOffsite: null, assistantToken: null };
      const job = ownerJobs({ config, ledger: f.ledger, clock: f.clock, logger: memoryLogger().logger, heartbeats, health: healthSourcesFor(config, heartbeats) }).find((j) => j.name === "linkRequestStuck");
      await job?.run(new AbortController().signal);
      await job?.run(new AbortController().signal);
      expect(stuckRows(f.ledger)).toHaveLength(1);
    }
  });

  async function stuckText(f: ReturnType<typeof fixture>): Promise<string> {
    f.ledger.tx((db) => holdShopeeQueue(db, "captcha", f.held()));
    raise(f);
    await f.deliver();
    return f.sent.at(-1) ?? "";
  }

  it("a request with a product name shows the name and not the link", async () => {
    const f = fixture();
    const requestId = queueLink(f.ledger, C1);
    f.ledger.sqlite.prepare("UPDATE link_requests SET product_name = 'Noi com dien' WHERE request_id = ?").run(requestId);
    const text = await stuckText(f);
    expect(text).toContain("S\u1ea3n ph\u1ea9m: Noi com dien");
    expect(text).not.toContain("shopee.vn/product");
  });

  it("a source link over 200 characters is cut to 200, and a name is never cut inside an emoji", async () => {
    const f = fixture();
    const requestId = queueLink(f.ledger, C1);
    const long = `https://shopee.vn/${"a".repeat(300)}`;
    f.ledger.sqlite.prepare("UPDATE link_requests SET source_url = ? WHERE request_id = ?").run(long, requestId);
    expect(await stuckText(f)).toContain(`S\u1ea3n ph\u1ea9m: ${long.slice(0, 200)}\n`);
    const g = fixture();
    const named = queueLink(g.ledger, C1);
    g.ledger.sqlite.prepare("UPDATE link_requests SET product_name = ? WHERE request_id = ?").run(`${"a".repeat(199)}\u{1F600}b`, named);
    expect(await stuckText(g)).toContain(`S\u1ea3n ph\u1ea9m: ${"a".repeat(199)}\u{1F600}\n`);
  });

  it("a merged owner shows the survivor's name and id, and the id alone once the survivor is erased", async () => {
    const f = fixture();
    queueLink(f.ledger, C1);
    f.ledger.sqlite.prepare("UPDATE customers SET display_name = 'Tran Binh' WHERE customer_id = ?").run(C2);
    f.ledger.sqlite.prepare("UPDATE customers SET status = 'MERGED', display_name = NULL WHERE customer_id = ?").run(C1);
    f.ledger.sqlite.prepare("INSERT INTO customer_aliases (alias, customer_id, note) VALUES (?, ?, 'merge')").run(C1, C2);
    const text = await stuckText(f);
    expect(text).toContain(`Tran Binh (ID: ${C2})`);
    expect(text).not.toContain(C1);
    const g = fixture();
    queueLink(g.ledger, C1);
    g.ledger.sqlite.prepare("UPDATE customers SET status = 'ERASED', erased_at = ?, display_name = NULL WHERE customer_id = ?").run(LINK_START, C2);
    g.ledger.sqlite.prepare("UPDATE customers SET status = 'MERGED', display_name = NULL WHERE customer_id = ?").run(C1);
    g.ledger.sqlite.prepare("INSERT INTO customer_aliases (alias, customer_id, note) VALUES (?, ?, 'merge')").run(C1, C2);
    const erased = await stuckText(g);
    expect(erased).toContain(`Kh\u00e1ch ID: ${C2}`);
    expect(erased).not.toContain("S\u1ea3n ph\u1ea9m:");
  });
});

describe("a stuck request follows when the queue reopens", () => {
  const SECOND = 1_000;

  function pausedFor(ms: number, channel: "zalo" | "web" = "zalo") {
    const f = fixture();
    f.ledger.sqlite.prepare("UPDATE customers SET zalo_user_id = '70001' WHERE customer_id = ?").run(C1);
    const requestId = queueLink(f.ledger, C1, SHOPEE_PRODUCT, f.clock, channel);
    f.ledger.tx((db) => pauseShopeeQueue(db, "login_redirect", f.clock.now()));
    raiseStuckRequestAlerts(f.ledger, f.clock, SILENT);
    f.clock.advance(ms);
    f.ledger.tx((db) => resumeShopeeQueue(db, commandAudit(db, f.clock, { kind: "system", id: "test" }), f.clock.now()));
    return { ...f, requestId };
  }

  it("by the existing notification, once, after a short stop", async () => {
    const p = pausedFor(60 * SECOND);
    await runLinks(p.ledger, fakeBridge(), { clock: p.clock });
    expect(runLinkDeliveryCheck(p.ledger, p.clock)).toEqual({ notified: 1, closed: 0 });
    expect(runLinkDeliveryCheck(p.ledger, p.clock)).toEqual({ notified: 0, closed: 0 });
    expect(outboxRows(p.ledger).map((r) => r.message_key)).toEqual(["link_ready"]);
    expect(p.ledger.sqlite.prepare("SELECT count(*) AS n FROM alerts WHERE kind = 'link_request_stuck'").get()).toEqual({ n: 1 });
  });

  it("even after a stop longer than the 2 hours an unsent link is kept: the customer was told it would follow", async () => {
    const p = pausedFor(LINK_STALE_AFTER_MS + 60 * SECOND);
    const routes = routesFor(p);
    await runLinks(p.ledger, fakeBridge(), { clock: p.clock });
    p.clock.advance(SECOND);
    expect(runLinkDeliveryCheck(p.ledger, p.clock)).toEqual({ notified: 1, closed: 0 });
    const handed = await routes.next();
    expect(handed?.link?.requestId).toBe(p.requestId);
    await routes.ack(handed?.id ?? 0);
    expect(requestRow(p.ledger, p.requestId)).toEqual({ status: "DELIVERED", deliveredAt: p.clock.now() });
    p.clock.advance(LINK_STALE_AFTER_MS + SECOND);
    expect(runLinkDeliveryCheck(p.ledger, p.clock)).toEqual({ notified: 0, closed: 0 });
    expect(outboxRows(p.ledger).map((r) => r.message_key)).toEqual(["link_ready"]);
  });

  it("a link made late and never handed over is closed 2 hours after it was made", async () => {
    const p = pausedFor(LINK_STALE_AFTER_MS + 60 * SECOND);
    await runLinks(p.ledger, fakeBridge(), { clock: p.clock });
    p.clock.advance(LINK_STALE_AFTER_MS + SECOND);
    expect(runLinkDeliveryCheck(p.ledger, p.clock)).toEqual({ notified: 0, closed: 1 });
    expect(outboxRows(p.ledger)).toEqual([]);
  });

  it("a Zalo request retrying over 2 hours with no stop gets its link", async () => {
    const f = fixture();
    f.ledger.sqlite.prepare("UPDATE customers SET zalo_user_id = '70001' WHERE customer_id = ?").run(C1);
    const requestId = queueLink(f.ledger, C1, SHOPEE_PRODUCT, f.clock);
    await runLinks(f.ledger, answeringBridge(() => ({ outcome: "failed", reason: "link_unresolved" })), { clock: f.clock });
    expect(requestRow(f.ledger, requestId).status).toBe("QUEUED");
    f.clock.advance(LINK_STALE_AFTER_MS + 60 * SECOND);
    await runLinks(f.ledger, fakeBridge(), { clock: f.clock });
    expect(runLinkDeliveryCheck(f.ledger, f.clock)).toEqual({ notified: 1, closed: 0 });
    expect(outboxRows(f.ledger).map((r) => r.message_key)).toEqual(["link_ready"]);
  });

  it("a request with no channel recorded keeps the request's time: closed without a message", async () => {
    const p = pausedFor(LINK_STALE_AFTER_MS + 60 * SECOND);
    p.ledger.sqlite.prepare("UPDATE link_requests SET channel = NULL WHERE request_id = ?").run(p.requestId);
    await runLinks(p.ledger, fakeBridge(), { clock: p.clock });
    expect(runLinkDeliveryCheck(p.ledger, p.clock)).toEqual({ notified: 0, closed: 1 });
    expect(outboxRows(p.ledger)).toEqual([]);
  });

  it("a web request keeps the website's rule: closed without a message after 2 hours", async () => {
    const p = pausedFor(LINK_STALE_AFTER_MS + 60 * SECOND, "web");
    await runLinks(p.ledger, fakeBridge(), { clock: p.clock });
    expect(runLinkDeliveryCheck(p.ledger, p.clock)).toEqual({ notified: 0, closed: 1 });
    expect(outboxRows(p.ledger)).toEqual([]);
  });
});

describe("the link reply says the queue is stopped", () => {
  function app() {
    const f = fixture();
    return { ...f, ...routesFor(f) };
  }

  it("no stop: the reply is as it was, without the field", async () => {
    const a = app();
    expect(await a.reply(queueLink(a.ledger, C1))).not.toHaveProperty("queueStopped");
  });

  it("a page error hold: no field; a captcha hold or a lost login: true; once reopened: gone", async () => {
    const a = app();
    const requestId = queueLink(a.ledger, C1);
    a.ledger.tx((db) => holdShopeeQueue(db, "page_error", instantFromMs(toMs(a.clock.now()) + PAGE_ERROR_HOLD_MS)));
    expect(await a.reply(requestId)).not.toHaveProperty("queueStopped");
    a.ledger.tx((db) => holdShopeeQueue(db, "captcha", a.held()));
    expect((await a.reply(requestId)).queueStopped).toBe(true);
    a.ledger.tx((db) => pauseShopeeQueue(db, "login_redirect", a.clock.now()));
    expect((await a.reply(requestId)).queueStopped).toBe(true);
    a.ledger.tx((db) => resumeShopeeQueue(db, commandAudit(db, a.clock, { kind: "system", id: "test" }), a.clock.now()));
    expect(await a.reply(requestId)).not.toHaveProperty("queueStopped");
  });

  it("a link already made, and a TikTok Shop request, never say it", async () => {
    const a = app();
    const made = queueLink(a.ledger, C1);
    await runLinks(a.ledger, answeringBridge((job) => ({ outcome: "link", url: `https://s.shopee.vn/x?sub_id1=${job.subId1}`, resolvedUrl: `https://shopee.vn/x?utm_content=${job.subId1}-${job.subId2}` })), { clock: a.clock });
    const tiktok = queueLink(a.ledger, C1, TIKTOK);
    a.ledger.tx((db) => holdShopeeQueue(db, "captcha", a.held()));
    const answer = await a.reply(made);
    expect(answer).not.toHaveProperty("queueStopped");
    expect(await a.reply(tiktok)).not.toHaveProperty("queueStopped");
  });

  it("a stuck request follows once the hold ends: the link is made and goes by one notification", async () => {
    const a = app();
    a.ledger.sqlite.prepare("UPDATE customers SET zalo_user_id = '70001' WHERE customer_id = ?").run(C1);
    const requestId = queueLink(a.ledger, C1, SHOPEE_PRODUCT, a.clock);
    a.ledger.tx((db) => holdShopeeQueue(db, "captcha", a.held()));
    expect((await a.reply(requestId)).queueStopped).toBe(true);
    raiseStuckRequestAlerts(a.ledger, a.clock, SILENT);
    expect(outboxRows(a.ledger)).toEqual([]);
    a.clock.advance(CAPTCHA_HOLD_MS + 1);
    expect(await a.reply(requestId)).not.toHaveProperty("queueStopped");
    await runLinks(a.ledger, fakeBridge(), { clock: a.clock });
    expect((await a.reply(requestId)).shareUrl).toMatch(/\/s\//);
    expect(runLinkDeliveryCheck(a.ledger, a.clock)).toEqual({ notified: 1, closed: 0 });
    const handed = await a.next();
    expect(handed?.link?.requestId).toBe(requestId);
    await a.ack(handed?.id ?? 0);
    expect(requestRow(a.ledger, requestId).status).toBe("DELIVERED");
    expect(runLinkDeliveryCheck(a.ledger, a.clock)).toEqual({ notified: 0, closed: 0 });
    expect(await a.next()).toBeNull();
    expect(outboxRows(a.ledger).map((r) => r.message_key)).toEqual(["link_ready"]);
  });
});
