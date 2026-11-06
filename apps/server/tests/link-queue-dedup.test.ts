/**
 * D68, server side: one queued request per link for one customer, and a captcha hold that ends when
 * the bridge sees the verification page left. The ledger is a migrated one; the extension is played
 * by calls to the route.
 */
import { join } from "node:path";
import { BRIDGE_INSTANCE_HEADER, BRIDGE_TOKEN_HEADER, BRIDGE_VERIFICATION_CLEARED_PATH } from "@cashback/contracts";
import { fixedClock, instantFromMs, toMs, type Clock, type Instant } from "@cashback/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { linkBridge, linkEffectsFor, runLinkDeliveryCheck, verificationClearedRoutes } from "../src/links/link-jobs";
import { CAPTCHA_HOLD_MS, clearCaptchaHold, fakeBridge, holdShopeeQueue, LINK_REPLY_WAIT_MS, PAGE_ERROR_HOLD_MS, pauseShopeeQueue, queueLinkRequest, runLinkJob, shopeeQueueGate, shopeeQueueState, shopeeQueueStopReason, webLinkQuota } from "../src/modules/linking/index";
import { commandAudit } from "../src/modules/operations/index";
import { parseConfig, REPOSITORY_ROOT } from "../src/platform/config/env.config";
import { openLedger, type Ledger, type LedgerDb } from "../src/platform/db/ledger";
import { MIGRATIONS_DIR, readMigrations, runMigrations } from "../src/platform/db/migrations";
import { INTERNAL_TOKEN_HEADER } from "../src/platform/http/internal-token.guard";
import { buildServers, type Servers } from "../src/platform/http/servers";
import { createLogger } from "../src/platform/log/logger";
import { createScheduler, systemTimer } from "../src/platform/jobs/scheduler";
import { onCaptchaCleared, reconcileAfterCaptchaCleared } from "../src/reconcile/reconcile-jobs";
import { randomPort, sandbox, startServer, waitFor } from "./helpers/server-process";
import { tempDir } from "./helpers/live-fixture";

const NOW = "2026-11-06T03:00:00.000Z" as Instant;
const CLOCK = fixedClock(NOW);
const later = (ms: number): Clock => fixedClock(instantFromMs(toMs(NOW) + ms));
const SILENT = createLogger({ level: "fatal" });
const A = "1000000000000000001";
const B = "1000000000000000002";
const OLD_ID = "1000000000000000004";
const SHORT = "https://s.shopee.vn/AbC123";
const SEARCH = "https://shopee.vn/search?keyword=a";
const PRODUCT = "https://shopee.vn/Ao-thun-i.11001.22001";
const INTERNAL = "i".repeat(40);
const BRIDGE = "b".repeat(40);
const INSTANCE = "a".repeat(32);
const CLIENT_KEY = "c".repeat(32);
const BROWSER = { INTERNAL_TOKEN: INTERNAL, BRIDGE_MODE: "browser", BRIDGE_TOKEN: BRIDGE, BROWSER_PROFILE_DIR: join(REPOSITORY_ROOT, ".browser-profile", "dev") };
const BRIDGE_HEADERS = { [BRIDGE_TOKEN_HEADER]: BRIDGE, [BRIDGE_INSTANCE_HEADER]: INSTANCE };

const ledgers: Ledger[] = [];
const servers: Servers[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await Promise.all([s.publicApp.close(), s.internalApp.close()]);
  for (const l of ledgers.splice(0)) l.close();
});

function seeded(): Ledger {
  const ledger = openLedger(join(tempDir("cashback-dedup-"), "ledger.sqlite"));
  runMigrations(ledger, readMigrations(MIGRATIONS_DIR), CLOCK);
  ledger.sqlite.exec(`INSERT INTO customers (customer_id, customer_code, role, status) VALUES ('${A}', 'DP00001', 'USER', 'ACTIVE'), ('${B}', 'DP00002', 'USER', 'ACTIVE'), ('${OLD_ID}', 'DP00004', 'USER', 'MERGED'), ('HOUSE', NULL, 'HOUSE', 'ACTIVE')`);
  ledger.sqlite.prepare("INSERT INTO customer_aliases (alias, customer_id) VALUES (?, ?)").run(OLD_ID, A);
  ledgers.push(ledger);
  return ledger;
}

const ask = (ledger: Ledger, customer: string, url: string, prefix = "") => ledger.tx((db) => queueLinkRequest(db, { customer, url, channel: "zalo" }, CLOCK, prefix));
const requestCount = (ledger: Ledger) => (ledger.sqlite.prepare("SELECT count(*) AS n FROM link_requests").get() as { n: number }).n;
const by = (db: LedgerDb) => commandAudit(db, CLOCK, { kind: "system", id: "bridge" });
const audits = (ledger: Ledger) => ledger.sqlite.prepare("SELECT event, entity_id, actor_id FROM audit_entries WHERE event = 'linking.link_queue.captcha_cleared'").all();

describe("D68: one queued request per link for one customer", () => {
  for (const [name, url] of [["a short link", SHORT], ["a search link", SEARCH], ["a product link", PRODUCT]] as const) {
    it(`${name} resent while it waits gets the same request and no new row`, () => {
      const ledger = seeded();
      const first = ask(ledger, A, url);
      expect(first.reused).toBe(false);
      expect(ask(ledger, A, url)).toEqual({ requestId: first.requestId, customerId: A, status: "QUEUED", reused: true, shareCode: null });
      expect(requestCount(ledger)).toBe(1);
    });
  }

  it("any of the customer's merged keys is the same customer", () => {
    const ledger = seeded();
    const first = ask(ledger, A, SHORT);
    expect(ask(ledger, OLD_ID, SHORT)).toMatchObject({ requestId: first.requestId, customerId: A, reused: true });
    expect(ask(ledger, "DP00001", SHORT)).toMatchObject({ requestId: first.requestId, reused: true });
    // A row still under the old id, from before the merge.
    ledger.sqlite.prepare("UPDATE link_requests SET customer_id = ? WHERE request_id = ?").run(OLD_ID, first.requestId);
    expect(ask(ledger, A, SHORT)).toMatchObject({ requestId: first.requestId, customerId: A, reused: true });
  });

  it("another customer with the same link gets a request of their own (D6)", () => {
    const ledger = seeded();
    const first = ask(ledger, A, SHORT);
    const other = ask(ledger, B, SHORT);
    expect(other).toMatchObject({ customerId: B, reused: false });
    expect(other.requestId).not.toBe(first.requestId);
  });

  it("guests are strangers on one HOUSE account: a link that names no product keeps new requests", () => {
    const ledger = seeded();
    const first = ask(ledger, "HOUSE", SHORT);
    const second = ask(ledger, "HOUSE", SHORT);
    expect([first.reused, second.reused]).toEqual([false, false]);
    expect(second.requestId).not.toBe(first.requestId);
  });

  it("a resend on another channel makes a new request; on the same channel it is handed back", () => {
    const ledger = seeded();
    const zalo = ask(ledger, A, SHORT);
    const web = () => ledger.tx((db) => queueLinkRequest(db, { customer: A, url: SHORT, channel: "web", web: { access: "SESSION", clientKey: CLIENT_KEY } }, CLOCK));
    const first = web();
    expect(first.reused).toBe(false);
    expect(first.requestId).not.toBe(zalo.requestId);
    expect(web()).toMatchObject({ requestId: first.requestId, reused: true });
    expect(ask(ledger, A, SHORT)).toMatchObject({ requestId: zalo.requestId, reused: true });
  });

  it("only a QUEUED request matches: a FAILED or a made one leaves the existing rules", () => {
    const ledger = seeded();
    for (const status of ["FAILED", "ISSUED"]) {
      const first = ask(ledger, A, SHORT);
      ledger.sqlite.prepare("UPDATE link_requests SET status = ? WHERE request_id = ?").run(status, first.requestId);
      const next = ask(ledger, A, SHORT);
      expect(next.reused).toBe(false);
      expect(next.requestId).not.toBe(first.requestId);
      ledger.sqlite.prepare("UPDATE link_requests SET status = 'FAILED' WHERE request_id = ?").run(next.requestId);
    }
  });

  it("a product whose last request FAILED but has one waiting hands back the waiting one", () => {
    const ledger = seeded();
    const failed = ask(ledger, A, PRODUCT);
    ledger.sqlite.prepare("UPDATE link_requests SET status = 'FAILED' WHERE request_id = ?").run(failed.requestId);
    const waiting = ask(ledger, A, PRODUCT);
    expect(waiting.requestId).not.toBe(failed.requestId);
    expect(ask(ledger, A, PRODUCT)).toMatchObject({ requestId: waiting.requestId, reused: true });
  });

  it("an imported QUEUED row, which the link job never serves, and in dev a production row, do not match", () => {
    const ledger = seeded();
    const imported = ask(ledger, A, SHORT);
    ledger.sqlite.prepare("UPDATE link_requests SET origin = 'CUTOVER' WHERE request_id = ?").run(imported.requestId);
    const live = ask(ledger, A, SHORT);
    expect(live.reused).toBe(false);
    const dev = ask(ledger, A, SHORT, "DEV");
    expect(dev.reused).toBe(false);
    expect(dev.requestId.startsWith("DEV")).toBe(true);
    expect(ask(ledger, A, SHORT, "DEV")).toMatchObject({ requestId: dev.requestId, reused: true });
  });

  it("two requests already queued stay as they are, and the oldest is handed back", () => {
    const ledger = seeded();
    const first = ask(ledger, A, SHORT);
    ledger.sqlite.prepare("INSERT INTO link_requests (request_id, customer_id, network, platform, channel, status, source_url, created_at, origin) SELECT '26110699999', customer_id, network, platform, channel, status, source_url, ?, origin FROM link_requests WHERE request_id = ?").run(later(1000).now(), first.requestId);
    expect(ask(ledger, A, SHORT)).toMatchObject({ requestId: first.requestId, reused: true });
    expect(requestCount(ledger)).toBe(2);
  });

  it("a resend on the website costs no quota: the quota check runs for a new request only", () => {
    const ledger = seeded();
    let checks = 0;
    const web = () => ledger.tx((db) => queueLinkRequest(db, { customer: A, url: SHORT, channel: "web", web: { access: "SESSION", clientKey: CLIENT_KEY } }, CLOCK, "", () => undefined, true, () => void checks++));
    const first = web();
    expect(checks).toBe(1);
    expect(web()).toMatchObject({ requestId: first.requestId, reused: true });
    expect(checks).toBe(1);
    expect(ledger.tx((db) => webLinkQuota(db, { access: "SESSION", customerId: A, clientKey: CLIENT_KEY }, CLOCK))).toBe("ok");
    expect(requestCount(ledger)).toBe(1);
  });

  it("AC: three sends of one short link while the queue is held make one link and one notification when it reopens", async () => {
    const ledger = seeded();
    ledger.tx((db) => holdShopeeQueue(db, "captcha", later(CAPTCHA_HOLD_MS).now()));
    const ids = [ask(ledger, A, SHORT), ask(ledger, A, SHORT), ask(ledger, A, SHORT)].map((r) => r.requestId);
    expect(new Set(ids).size).toBe(1);
    const jobs: unknown[] = [];
    const fake = fakeBridge();
    const bridge = { ...fake, createLink: async (job: Parameters<typeof fake.createLink>[0], signal: AbortSignal) => (jobs.push(job), fake.createLink(job, signal)) };
    const open = later(CAPTCHA_HOLD_MS);
    expect(await runLinkJob({ ledger, clock: open, bridge, subIdPrefix: "", logger: SILENT, effects: linkEffectsFor(open) }, new AbortController().signal)).toMatchObject({ issued: 1 });
    expect(jobs).toHaveLength(1);
    runLinkDeliveryCheck(ledger, later(CAPTCHA_HOLD_MS + LINK_REPLY_WAIT_MS + 1));
    runLinkDeliveryCheck(ledger, later(CAPTCHA_HOLD_MS + LINK_REPLY_WAIT_MS + 2));
    expect(ledger.sqlite.prepare("SELECT customer_id, message_key FROM outbox").all()).toHaveLength(1);
  });
});

describe("D68: a captcha cleared ends its hold at once", () => {
  const held = (ledger: Ledger) => ledger.tx((db) => holdShopeeQueue(db, "captcha", later(CAPTCHA_HOLD_MS).now()));

  it("clears a captcha hold with one audit entry; the queue opens and the customers stop being told it is stopped", () => {
    const ledger = seeded();
    held(ledger);
    expect(shopeeQueueStopReason(ledger.db, NOW)).toBe("captcha");
    expect(ledger.tx((db) => clearCaptchaHold(db, by(db), NOW))).toBe(true);
    expect(shopeeQueueGate(ledger.db, NOW)).toBe("open");
    expect(shopeeQueueStopReason(ledger.db, NOW)).toBeNull();
    expect(ledger.tx((db) => clearCaptchaHold(db, by(db), NOW))).toBe(false);
    expect(audits(ledger)).toEqual([{ event: "linking.link_queue.captcha_cleared", entity_id: "shopee", actor_id: "bridge" }]);
  });

  it("changes nothing with no hold, or with one that has expired", () => {
    const ledger = seeded();
    expect(ledger.tx((db) => clearCaptchaHold(db, by(db), NOW))).toBe(false);
    held(ledger);
    expect(ledger.tx((db) => clearCaptchaHold(db, by(db), later(CAPTCHA_HOLD_MS).now()))).toBe(false);
    expect(shopeeQueueState(ledger.db).heldReason).toBe("captcha");
    expect(audits(ledger)).toEqual([]);
  });

  it("never lifts a lost-login pause: the captcha hold beside it ends, the pause stays", () => {
    const ledger = seeded();
    ledger.tx((db) => pauseShopeeQueue(db, "login_redirect", NOW));
    expect(ledger.tx((db) => clearCaptchaHold(db, by(db), NOW))).toBe(false);
    held(ledger);
    expect(ledger.tx((db) => clearCaptchaHold(db, by(db), NOW))).toBe(true);
    expect(shopeeQueueGate(ledger.db, NOW)).toBe("paused");
    expect(shopeeQueueState(ledger.db).pausedReason).toBe("login_redirect");
  });

  it("a page error hold keeps its own rule", () => {
    const ledger = seeded();
    ledger.tx((db) => holdShopeeQueue(db, "page_error", later(PAGE_ERROR_HOLD_MS).now()));
    expect(ledger.tx((db) => clearCaptchaHold(db, by(db), NOW))).toBe(false);
    expect(shopeeQueueGate(ledger.db, NOW)).toBe("held");
  });

  describe("the route", () => {
    function served(ledger: Ledger, onCleared: (db: LedgerDb) => void = () => undefined): Servers {
      const s = buildServers({ clock: CLOCK, internalToken: INTERNAL, bridgeToken: BRIDGE, internal: verificationClearedRoutes({ ledger, clock: CLOCK }, linkBridge(parseConfig("dev", BROWSER)), onCleared) });
      servers.push(s);
      return s;
    }
    const post = (s: Servers, headers: Record<string, string> = BRIDGE_HEADERS) => s.internalApp.inject({ method: "POST", url: BRIDGE_VERIFICATION_CLEARED_PATH, headers });

    it("the next link job starts without waiting for held_until, and the callback runs once", async () => {
      const ledger = seeded();
      held(ledger);
      const { requestId } = ask(ledger, A, SHORT);
      let told = 0;
      const s = served(ledger, () => void told++);
      expect((await post(s)).json()).toEqual({ cleared: true });
      expect((await post(s)).json()).toEqual({ cleared: false });
      expect(told).toBe(1);
      expect(await runLinkJob({ ledger, clock: CLOCK, bridge: fakeBridge(), subIdPrefix: "", logger: SILENT, effects: linkEffectsFor(CLOCK) }, new AbortController().signal)).toMatchObject({ issued: 1 });
      expect(ledger.sqlite.prepare("SELECT status FROM link_requests WHERE request_id = ?").get(requestId)).toEqual({ status: "ISSUED" });
    });

    it("only the bridge token opens it, with a well-formed instance id", async () => {
      const ledger = seeded();
      held(ledger);
      const s = served(ledger);
      expect((await post(s, { [BRIDGE_INSTANCE_HEADER]: INSTANCE })).statusCode).toBe(401);
      expect((await post(s, { [INTERNAL_TOKEN_HEADER]: INTERNAL, [BRIDGE_INSTANCE_HEADER]: INSTANCE })).statusCode).toBe(401);
      expect((await post(s, { [BRIDGE_TOKEN_HEADER]: BRIDGE })).statusCode).toBe(400);
      expect(shopeeQueueGate(ledger.db, NOW)).toBe("held");
    });

    it("a callback that throws is logged, not a 500: the hold has ended", async () => {
      const ledger = seeded();
      held(ledger);
      const lines: { msg?: string }[] = [];
      const logger = createLogger({ destination: { write: (line: string) => void lines.push(JSON.parse(line) as { msg?: string }) } });
      const routes = verificationClearedRoutes({ ledger, clock: CLOCK }, linkBridge(parseConfig("dev", BROWSER)), () => {
        throw new Error("boom");
      });
      const s = buildServers({ clock: CLOCK, internalToken: INTERNAL, bridgeToken: BRIDGE, logger, internal: routes });
      servers.push(s);
      const answer = await post(s);
      expect([answer.statusCode, answer.json()]).toEqual([200, { cleared: true }]);
      expect(lines.map((l) => l.msg)).toContain("linking.link_queue.after_clear_failed");
      expect(shopeeQueueGate(ledger.db, NOW)).toBe("open");
    });

    it("main.ts registers it with the browser bridge: the real entry point answers 200 and cleared false", async () => {
      const internalPort = randomPort();
      const server = startServer(sandbox([`INTERNAL_TOKEN=${INTERNAL}`, `BRIDGE_MODE=browser`, `BRIDGE_TOKEN=${BRIDGE}`, `BROWSER_PROFILE_DIR=${BROWSER.BROWSER_PROFILE_DIR.replaceAll("\\", "/")}`, `PUBLIC_PORT=${randomPort()}`, `INTERNAL_PORT=${internalPort}`]));
      try {
        await waitFor(server, "platform.server.started");
        const answer = await fetch(`http://127.0.0.1:${internalPort}${BRIDGE_VERIFICATION_CLEARED_PATH}`, { method: "POST", headers: BRIDGE_HEADERS });
        expect([answer.status, await answer.json()]).toEqual([200, { cleared: false }]);
      } finally {
        server.child.kill();
        await server.exited;
      }
    }, 40_000);

    it("the fake bridge has no such route", () => {
      const fake = parseConfig("dev", { INTERNAL_TOKEN: INTERNAL });
      expect(verificationClearedRoutes({ ledger: seeded(), clock: CLOCK }, linkBridge(fake), () => undefined)).toEqual([]);
    });
  });

  describe("the one reconcile after a failed run", () => {
    function run(ledger: Ledger, network: string, kind: string, outcome: string): void {
      ledger.sqlite.prepare("INSERT INTO reconciliation_runs (kind, network, window_from, window_to, started_at, finished_at, duration_ms, outcome, error_code) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)").run(kind, network, NOW, later(1000).now(), NOW, NOW, outcome, outcome === "SUCCEEDED" ? null : "report_fetch_failed");
    }
    const scheduler = (answer: "started" | "already_running" = "started") => {
      const asked: string[] = [];
      return { asked, trigger: (name: string) => (asked.push(name), answer) };
    };

    it("starts when the latest Shopee run failed, of whatever kind; not after a success or with no run", () => {
      const ledger = seeded();
      const jobs = scheduler();
      expect(reconcileAfterCaptchaCleared(ledger.db, CLOCK, jobs)).toBeNull();
      run(ledger, "shopee", "HOURLY", "SUCCEEDED");
      expect(reconcileAfterCaptchaCleared(ledger.db, CLOCK, jobs)).toBeNull();
      run(ledger, "accesstrade", "HOURLY", "FAILED");
      expect(reconcileAfterCaptchaCleared(ledger.db, CLOCK, jobs)).toBeNull();
      run(ledger, "shopee", "NIGHTLY", "FAILED");
      expect(reconcileAfterCaptchaCleared(ledger.db, CLOCK, jobs)).toBe("started");
      expect(jobs.asked).toEqual(["reconcile"]);
      run(ledger, "shopee", "HOURLY", "SUCCEEDED");
      expect(reconcileAfterCaptchaCleared(ledger.db, CLOCK, jobs)).toBeNull();
      expect(jobs.asked).toEqual(["reconcile"]);
    });

    it("onCaptchaCleared with a real scheduler: starts the reconcile job once, logs that it did, and logs that none started otherwise", async () => {
      const ledger = seeded();
      const lines: { msg?: string; started?: boolean; result?: string | null }[] = [];
      const logger = createLogger({ destination: { write: (line: string) => void lines.push(JSON.parse(line) as (typeof lines)[number]) } });
      let runs = 0;
      let finish = (): void => undefined;
      const going = new Promise<void>((resolve) => (finish = resolve));
      const jobs = createScheduler([{ name: "reconcile", context: "orders", schedule: { kind: "every", delayMs: 60_000 }, run: async () => (runs++, going) }], { clock: CLOCK, timer: systemTimer, logger });
      const told = () => lines.filter((l) => l.msg === "orders.reconciliation.after_captcha_cleared").map((l) => [l.started, l.result]);
      onCaptchaCleared(ledger.db, CLOCK, jobs, logger);
      run(ledger, "shopee", "HOURLY", "FAILED");
      onCaptchaCleared(ledger.db, CLOCK, null, logger);
      onCaptchaCleared(ledger.db, CLOCK, jobs, logger);
      onCaptchaCleared(ledger.db, CLOCK, jobs, logger);
      await vi.waitFor(() => expect(runs).toBe(1));
      expect(told()).toEqual([[false, null], [false, null], [true, "started"], [false, "already_running"]]);
      finish();
      await jobs.stop(1_000);
    });

    it("a run already going is left alone", () => {
      const ledger = seeded();
      run(ledger, "shopee", "HOURLY", "FAILED");
      expect(reconcileAfterCaptchaCleared(ledger.db, CLOCK, scheduler("already_running"))).toBe("already_running");
    });

    it("starts none while a lost login keeps the queue paused", () => {
      const ledger = seeded();
      run(ledger, "shopee", "HOURLY", "FAILED");
      ledger.tx((db) => pauseShopeeQueue(db, "login_redirect", NOW));
      const jobs = scheduler();
      expect(reconcileAfterCaptchaCleared(ledger.db, CLOCK, jobs)).toBeNull();
      expect(jobs.asked).toEqual([]);
    });

    it("a clear with no hold starts none: the callback does not run", async () => {
      const ledger = seeded();
      run(ledger, "shopee", "HOURLY", "FAILED");
      const jobs = scheduler();
      const s = buildServers({ clock: CLOCK, internalToken: INTERNAL, bridgeToken: BRIDGE, internal: verificationClearedRoutes({ ledger, clock: CLOCK }, linkBridge(parseConfig("dev", BROWSER)), (db) => void reconcileAfterCaptchaCleared(db, CLOCK, jobs)) });
      servers.push(s);
      expect((await s.internalApp.inject({ method: "POST", url: BRIDGE_VERIFICATION_CLEARED_PATH, headers: BRIDGE_HEADERS })).json()).toEqual({ cleared: false });
      expect(jobs.asked).toEqual([]);
      held(ledger);
      expect((await s.internalApp.inject({ method: "POST", url: BRIDGE_VERIFICATION_CLEARED_PATH, headers: BRIDGE_HEADERS })).json()).toEqual({ cleared: true });
      expect(jobs.asked).toEqual(["reconcile"]);
    });
  });
});
