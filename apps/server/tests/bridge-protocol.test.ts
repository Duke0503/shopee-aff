/**
 * Story 5.3, server side: the browser bridge takes one job at a time over the internal listener
 * (AD-14, AD-18, AD-25, D8, D47, INV-7). The queue's timers are a manual clock, so every wait is
 * deterministic; the extension is played by test calls to the two routes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BRIDGE_INSTANCE_HEADER, BRIDGE_TOKEN_HEADER, type BridgeJob, type BridgeLinkJob } from "@cashback/contracts";
import { fixedClock } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";

import { linkBridge, linkEffectsFor, linkRoutes } from "../src/links/link-jobs";
import { bridgeInternalRoutes, browserBridge, queueLinkRequest, runLinkJob, type BridgeTimer, type BrowserBridge } from "../src/modules/linking/index";
import { parseConfig } from "../src/platform/config/env.config";
import { isolationProblems, productionIdentifiers } from "../src/platform/config/isolation.config";
import { REPOSITORY_ROOT } from "../src/platform/config/env.config";
import { openLedger, type Ledger } from "../src/platform/db/ledger";
import { MIGRATIONS_DIR, readMigrations, runMigrations } from "../src/platform/db/migrations";
import { ASSISTANT_TOKEN_HEADER, INTERNAL_TOKEN_HEADER } from "../src/platform/http/internal-token.guard";
import { buildServers, type Servers } from "../src/platform/http/servers";
import { createLogger } from "../src/platform/log/logger";
import { tempDir } from "./helpers/live-fixture";

const CLOCK = fixedClock("2026-11-01T03:00:00.000Z");
const INTERNAL = "i".repeat(40);
const ASSISTANT = "a".repeat(40);
const BRIDGE = "b".repeat(40);
const SILENT = createLogger({ level: "fatal" });
const C1 = "1000000000000000001";
const PRODUCT = "https://shopee.vn/Ao-thun-i.11001.22001";
const NEVER = new AbortController().signal;

/** Timers that fire only when the test moves time on. */
function manualTimer(): BridgeTimer & { advance(ms: number): void; pending(): number } {
  let now = 0;
  let id = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  return {
    schedule: (fn, delayMs) => (due.set(++id, { at: now + delayMs, fn }), id),
    cancel: (handle) => void due.delete(handle as number),
    advance(ms) {
      now += ms;
      for (const [key, t] of [...due].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at > now || !due.has(key)) continue;
        due.delete(key);
        t.fn();
      }
    },
    pending: () => due.size,
  };
}

let tickets = 0;
const ticketMaker = () => (++tickets).toString(16).padStart(32, "0");
const bridgeWith = (timer = manualTimer()) => ({ timer, bridge: browserBridge({ timer, makeTicket: ticketMaker, pollMs: 25_000, pickupMs: 60_000, jobTimeoutMs: 90_000, answerGraceMs: 15_000 }) });

const ledgers: Ledger[] = [];
const servers: Servers[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await Promise.all([s.publicApp.close(), s.internalApp.close()]);
  for (const l of ledgers.splice(0)) l.close();
});

function internal(bridge: BrowserBridge, tokens: { bridge?: string | null } = {}): Servers {
  const s = buildServers({ clock: CLOCK, internalToken: INTERNAL, assistantToken: ASSISTANT, bridgeToken: tokens.bridge === undefined ? BRIDGE : tokens.bridge, internal: [bridgeInternalRoutes({ work: bridge.work })] });
  servers.push(s);
  return s;
}

const INSTANCE_A = "a".repeat(32);
const INSTANCE_B = "b".repeat(32);
/** The headers one extension instance sends. */
const as = (instance: string): Record<string, string> => ({ [BRIDGE_TOKEN_HEADER]: BRIDGE, [BRIDGE_INSTANCE_HEADER]: instance });
const poll = (s: Servers, headers: Record<string, string> = as(INSTANCE_A)) => s.internalApp.inject({ method: "GET", url: "/internal/bridge/next", headers });
const answer = (s: Servers, payload: object, headers: Record<string, string> = as(INSTANCE_A)) => s.internalApp.inject({ method: "POST", url: "/internal/bridge/results", headers, payload });
const settle = () => new Promise((resolve) => setImmediate(resolve));

function ledgerWithCustomer(): Ledger {
  const ledger = openLedger(join(tempDir("cashback-bridge-"), "ledger.sqlite"));
  runMigrations(ledger, readMigrations(MIGRATIONS_DIR), CLOCK);
  ledger.sqlite.exec(`INSERT INTO customers (customer_id, customer_code, role, status) VALUES ('${C1}', 'DP00001', 'USER', 'ACTIVE'), ('HOUSE', NULL, 'HOUSE', 'ACTIVE')`);
  ledgers.push(ledger);
  return ledger;
}

describe("Story 5.3: the browser bridge takes one job at a time over the internal listener", () => {
  it("AC1: with report, lookup and link jobs queued, the bridge gets the link job first and only one job is outstanding at a time", async () => {
    const { bridge } = bridgeWith();
    const s = internal(bridge);
    const report = bridge.submit({ kind: "report", page: 1, purchaseTimeStart: 1_761_955_200, purchaseTimeEnd: 1_762_041_599 }, NEVER);
    const lookup = bridge.submit({ kind: "lookup", url: PRODUCT }, NEVER);
    const link = bridge.submit({ kind: "link", sourceUrl: PRODUCT, subId1: C1, subId2: "26110100001" }, NEVER);

    const first = (await poll(s)).json() as BridgeJob;
    expect(first).toMatchObject({ kind: "link", sourceUrl: PRODUCT, subId1: C1, subId2: "26110100001", timeoutMs: 90_000 });
    // Polling again before answering gets the same job: never a second one while one is out.
    expect((await poll(s)).json()).toEqual(first);
    expect(await answer(s, { ticket: "f".repeat(32), outcome: "failed", reason: "no_link" }).then((r) => r.json())).toEqual({ accepted: false });

    expect((await answer(s, { ticket: first.ticket, outcome: "link", url: `https://s.shopee.vn/x?utm_content=${C1}-26110100001---` })).json()).toEqual({ accepted: true });
    expect(await link).toEqual({ outcome: "link", url: `https://s.shopee.vn/x?utm_content=${C1}-26110100001---` });
    const second = (await poll(s)).json() as BridgeJob;
    expect(second.kind).toBe("lookup");
    await answer(s, { ticket: second.ticket, outcome: "value", value: { price: 100000 } });
    expect(await lookup).toEqual({ outcome: "value", value: { price: 100000 } });
    const third = (await poll(s)).json() as BridgeJob;
    expect(third.kind).toBe("report");
    await answer(s, { ticket: third.ticket, outcome: "failed", reason: "unsupported" });
    expect(await report).toEqual({ outcome: "failed", reason: "unsupported" });
  });

  it("AC1: a link request goes from the link job through the polling bridge to an ISSUED link carrying its own sub_ids", async () => {
    const ledger = ledgerWithCustomer();
    const { bridge } = bridgeWith();
    const s = internal(bridge);
    const { requestId } = ledger.tx((db) => queueLinkRequest(db, { customer: "DP00001", url: PRODUCT, channel: "zalo" }, CLOCK));
    const running = runLinkJob({ ledger, clock: CLOCK, bridge, subIdPrefix: "", logger: SILENT, effects: linkEffectsFor(CLOCK) }, NEVER);
    const job = (await poll(s)).json() as BridgeJob;
    expect(job).toMatchObject({ kind: "link", subId1: C1, subId2: requestId });
    await answer(s, { ticket: job.ticket, outcome: "link", url: `https://shopee.vn/p-i.11001.22001?utm_content=${C1}-${requestId}---` });
    expect(await running).toEqual({ issued: 1, failed: 0, interrupted: false });
    expect(ledger.sqlite.prepare("SELECT status FROM link_requests WHERE request_id = ?").get(requestId)).toEqual({ status: "ISSUED" });
  });

  it("AC2: with no work the poll is held on the server until work arrives, or answers 204 when the server-side wait ends", async () => {
    const { bridge, timer } = bridgeWith();
    const s = internal(bridge);
    let answered = false;
    const held = poll(s).then((r) => ((answered = true), r));
    await settle();
    timer.advance(24_999);
    await settle();
    expect(answered).toBe(false);
    void bridge.submit({ kind: "link", sourceUrl: PRODUCT, subId1: C1, subId2: "26110100001" }, NEVER);
    const res = await held;
    expect([res.statusCode, (res.json() as BridgeJob).kind]).toEqual([200, "link"]);

    const { bridge: idle, timer: idleTimer } = bridgeWith();
    const empty = poll(internal(idle));
    await settle();
    idleTimer.advance(25_000);
    const timedOut = await empty;
    expect([timedOut.statusCode, timedOut.body]).toEqual([204, ""]);
    expect(idleTimer.pending()).toBe(0);
  });

  it("AC2: a server stop lets a held poll go at once", async () => {
    const { bridge } = bridgeWith();
    const s = internal(bridge);
    const held = poll(s);
    await settle();
    await s.internalApp.close();
    expect((await held).statusCode).toBe(204);
  });

  it("AC3: the bridge routes answer 401 without the bridge token, with a wrong one, or with another caller's token; the bridge token opens nothing else", async () => {
    const { bridge } = bridgeWith();
    const s = internal(bridge);
    for (const headers of <Record<string, string>[]>[{}, { [BRIDGE_TOKEN_HEADER]: "c".repeat(40) }, { [BRIDGE_TOKEN_HEADER]: BRIDGE.slice(1) }, { [BRIDGE_TOKEN_HEADER]: `${BRIDGE}x` }, { [INTERNAL_TOKEN_HEADER]: INTERNAL }, { [ASSISTANT_TOKEN_HEADER]: ASSISTANT }]) {
      expect((await poll(s, headers)).statusCode).toBe(401);
      expect((await answer(s, { ticket: "0".repeat(32), outcome: "failed", reason: "no_link" }, headers)).statusCode).toBe(401);
    }
    expect((await s.internalApp.inject({ method: "GET", url: "/internal/ping", headers: { [BRIDGE_TOKEN_HEADER]: BRIDGE } })).statusCode).toBe(401);
    expect((await poll(internal(bridgeWith().bridge, { bridge: null }), { [BRIDGE_TOKEN_HEADER]: BRIDGE })).statusCode).toBe(401);
    // A malformed answer is refused, never delivered.
    expect((await answer(s, { ticket: "0".repeat(32), outcome: "link", url: "javascript:alert(1)" })).statusCode).toBe(400);
    expect(() => buildServers({ clock: CLOCK, internalToken: INTERNAL, bridgeToken: INTERNAL })).toThrow(/bridge token must differ/);
    expect(() => buildServers({ clock: CLOCK, internalToken: INTERNAL, assistantToken: ASSISTANT, bridgeToken: ASSISTANT })).toThrow(/bridge token must differ/);
    expect(() => buildServers({ clock: CLOCK, internalToken: INTERNAL, bridgeToken: "short" })).toThrow(/at least 32/);
    // Compared in constant time: every token goes through the one timingSafeEqual helper.
    const guard = readFileSync(join(REPOSITORY_ROOT, "apps/server/src/platform/http/internal-token.guard.ts"), "utf8");
    expect(guard).toMatch(/timingSafeEqual\(a, b\)/);
    expect(guard).toMatch(/!sameSecret\(given, expected\)/);
  });
});

describe("Story 5.3: the bridge survives the server or the browser restarting", () => {
  it("a job taken but never answered (the browser restarted) is given up uncounted, its request stays QUEUED, and the next run sends it again", async () => {
    const ledger = ledgerWithCustomer();
    const { bridge, timer } = bridgeWith();
    const s = internal(bridge);
    const { requestId } = ledger.tx((db) => queueLinkRequest(db, { customer: "DP00001", url: PRODUCT, channel: "zalo" }, CLOCK));
    const run = () => runLinkJob({ ledger, clock: CLOCK, bridge, subIdPrefix: "", logger: SILENT, effects: linkEffectsFor(CLOCK) }, NEVER);
    const first = run();
    const lost = (await poll(s)).json() as BridgeJob;
    timer.advance(105_000);
    expect(await first).toEqual({ issued: 0, failed: 0, interrupted: true });
    expect(ledger.sqlite.prepare("SELECT status, attempts FROM link_requests WHERE request_id = ?").get(requestId)).toEqual({ status: "QUEUED", attempts: 0 });
    expect(ledger.sqlite.prepare("SELECT status FROM bridge_jobs").all()).toEqual([{ status: "PENDING" }]);

    const second = run();
    const again = (await poll(s)).json() as BridgeJob;
    expect(again).toMatchObject({ subId1: C1, subId2: requestId });
    expect(again.ticket).not.toBe(lost.ticket);
    // The lost job's late answer is dropped; the live one counts.
    expect((await answer(s, { ticket: lost.ticket, outcome: "link", url: `https://shopee.vn/p?utm_content=${C1}-${requestId}---` })).json()).toEqual({ accepted: false });
    await answer(s, { ticket: again.ticket, outcome: "link", url: `https://shopee.vn/p?utm_content=${C1}-${requestId}---` });
    expect(await second).toEqual({ issued: 1, failed: 0, interrupted: false });
    expect(ledger.sqlite.prepare("SELECT count(*) AS n FROM bridge_jobs").get()).toEqual({ n: 1 });
  });

  it("with no bridge polling, a job is given up as no_bridge after the pickup wait and nothing is counted; a stop aborts the wait", async () => {
    const { bridge, timer } = bridgeWith();
    const waiting = bridge.createLink({ jobId: 1, requestId: "26110100001", sourceUrl: PRODUCT, subId1: C1, subId2: "26110100001" }, NEVER);
    timer.advance(60_000);
    expect(await waiting).toEqual({ outcome: "unavailable", reason: "no_bridge" });
    expect(timer.pending()).toBe(0);

    const stop = new AbortController();
    const stopped = bridge.submit({ kind: "report", page: 1, purchaseTimeStart: 1_761_955_200, purchaseTimeEnd: 1_762_041_599 }, stop.signal);
    stop.abort(new Error("shutdown"));
    await expect(stopped).rejects.toThrow("shutdown");
    expect(timer.pending()).toBe(0);
  });
});

describe("Story 5.3: the bridge token in the configuration", () => {
  const ctx = { identifiers: productionIdentifiers(REPOSITORY_ROOT, tempDir("cashback-home-")), prodEnv: null, devFileIsProdFile: false, caseInsensitive: process.platform === "win32" };
  const browserDev = { INTERNAL_TOKEN: INTERNAL, BRIDGE_MODE: "browser", BROWSER_PROFILE_DIR: join(REPOSITORY_ROOT, ".browser-profile", "dev") };
  const keys = (env: "dev" | "prod", values: Record<string, string>, prodEnv: Record<string, string> | null = null) => isolationProblems(parseConfig(env, values), { ...ctx, prodEnv }).map((p) => `${p.key} ${p.reason}`);

  it("is required with the browser bridge, distinct from the internal and assistant tokens, and never production's", () => {
    expect(keys("dev", { ...browserDev, BRIDGE_TOKEN: BRIDGE })).toEqual([]);
    expect(keys("dev", browserDev)).toEqual(["BRIDGE_TOKEN required"]);
    expect(keys("prod", { INTERNAL_TOKEN: INTERNAL, ZALO_MODE: "account", PUBLIC_BASE_URL: "https://hoantiendp.com" })).toEqual(["BRIDGE_TOKEN required"]);
    expect(keys("dev", { ...browserDev, BRIDGE_TOKEN: INTERNAL })).toEqual(["BRIDGE_TOKEN same_as_internal_token"]);
    expect(keys("dev", { ...browserDev, ASSISTANT_TOKEN: ASSISTANT, BRIDGE_TOKEN: ASSISTANT })).toEqual(["BRIDGE_TOKEN same_as_assistant_token"]);
    expect(keys("dev", { ...browserDev, BRIDGE_TOKEN: BRIDGE }, { BRIDGE_TOKEN: BRIDGE })).toEqual(["BRIDGE_TOKEN same_as_production"]);
    expect(JSON.stringify(keys("dev", { ...browserDev, BRIDGE_TOKEN: BRIDGE }, { BRIDGE_TOKEN: BRIDGE }))).not.toContain("bbbb");
  });

  it("the browser mode puts the bridge routes on the internal listener; the fake bridge has none", async () => {
    const ledger = ledgerWithCustomer();
    const input = { ledger, clock: CLOCK, logger: SILENT };
    const devBrowser = parseConfig("dev", { ...browserDev, BRIDGE_TOKEN: BRIDGE });
    const real = linkBridge(devBrowser);
    expect(real.port.mode).toBe("browser");
    expect(real.routes).toHaveLength(1);
    const routes = linkRoutes({ ...input, config: devBrowser }, real);
    const s = buildServers({ clock: CLOCK, internalToken: INTERNAL, bridgeToken: BRIDGE, internal: routes });
    servers.push(s);
    const open = poll(s);
    await settle();
    await s.internalApp.close();
    expect((await open).statusCode).toBe(204);

    const fakeDev = parseConfig("dev", { INTERNAL_TOKEN: INTERNAL });
    expect(linkBridge(fakeDev).routes).toEqual([]);
    const fake = linkRoutes({ ...input, config: fakeDev }, linkBridge(fakeDev));
    const f = buildServers({ clock: CLOCK, internalToken: INTERNAL, bridgeToken: BRIDGE, internal: fake });
    servers.push(f);
    expect((await poll(f)).statusCode).toBe(401);
    expect((await poll(f, { [INTERNAL_TOKEN_HEADER]: INTERNAL })).statusCode).toBe(404);
  });
});

const requestRow = (ledger: Ledger, id: string) => ledger.sqlite.prepare("SELECT status, attempts, next_attempt_at, source_url FROM link_requests WHERE request_id = ?").get(id) as { status: string; attempts: number; next_attempt_at: string | null; source_url: string };
const jobRows = (ledger: Ledger) => ledger.sqlite.prepare("SELECT request_id, status, failure, no_answers FROM bridge_jobs ORDER BY job_id").all() as { request_id: string; status: string; failure: string | null; no_answers: number }[];
const queue = (ledger: Ledger, url: string, clock = CLOCK) => ledger.tx((db) => queueLinkRequest(db, { customer: "DP00001", url, channel: "zalo" }, clock)).requestId;
const OTHER = "https://shopee.vn/Quan-i.11001.22002";

describe("Story 5.3 review: nothing blocks the line or hands a link out twice", () => {
  it("review 1: a long product link is cut to its canonical product URL and served; a non-product link too long for a job is refused at queue time", async () => {
    const ledger = ledgerWithCustomer();
    const longName = `https://shopee.vn/${"%E1%BA%A5o-thun-".repeat(200)}-i.11001.22001?sp_atk=${"x".repeat(300)}`;
    expect(longName.length).toBeGreaterThan(2048);
    const requestId = queue(ledger, longName);
    expect(requestRow(ledger, requestId).source_url).toBe("https://shopee.vn/product/11001/22001");
    const { bridge } = bridgeWith();
    const s = internal(bridge);
    const running = runLinkJob({ ledger, clock: CLOCK, bridge, subIdPrefix: "", logger: SILENT, effects: linkEffectsFor(CLOCK) }, NEVER);
    const res = await poll(s);
    expect(res.statusCode).toBe(200);
    const job = res.json() as BridgeJob;
    expect(job).toMatchObject({ sourceUrl: "https://shopee.vn/product/11001/22001" });
    await answer(s, { ticket: job.ticket, outcome: "link", url: `https://shopee.vn/p?utm_content=${C1}-${requestId}---` });
    expect((await running).issued).toBe(1);

    const search = `https://shopee.vn/search?keyword=${"a".repeat(2100)}`;
    expect(() => queue(ledger, search)).toThrow(expect.objectContaining({ code: "url_too_long" }));
  });

  it("review 1: a stored request that cannot be a valid job fails that job as bad_job, and the request behind it is served; no poll ever fails", async () => {
    const ledger = ledgerWithCustomer();
    ledger.sqlite.prepare("INSERT INTO link_requests (request_id, customer_id, network, platform, channel, status, source_url, created_at, origin) VALUES ('26110100001', ?, 'shopee', 'shopee', 'zalo', 'QUEUED', ?, '2026-11-01T01:00:00.000Z', 'REQUEST')").run(C1, `https://shopee.vn/search?q=${"y".repeat(3000)}`);
    const behind = queue(ledger, OTHER);
    const { bridge } = bridgeWith();
    const s = internal(bridge);
    const running = runLinkJob({ ledger, clock: CLOCK, bridge, subIdPrefix: "", logger: SILENT, effects: linkEffectsFor(CLOCK) }, NEVER);
    const res = await poll(s);
    expect(res.statusCode).toBe(200);
    const job = res.json() as BridgeJob;
    expect(job).toMatchObject({ subId2: behind });
    await answer(s, { ticket: job.ticket, outcome: "link", url: `https://shopee.vn/p?utm_content=${C1}-${behind}---` });
    expect(await running).toEqual({ issued: 1, failed: 1, interrupted: false });
    expect(jobRows(ledger)[0]).toMatchObject({ request_id: "26110100001", status: "FAILED", failure: "bad_job" });
    expect(requestRow(ledger, "26110100001")).toMatchObject({ status: "QUEUED", attempts: 1 });
    expect(requestRow(ledger, "26110100001").next_attempt_at).not.toBeNull();
  });

  it("review 1: a job that breaks the contract at hand-out is answered bad_job and the poll answers 204, never 500", async () => {
    const delivered: unknown[] = [];
    const broken = { ticket: "c".repeat(32), kind: "link", sourceUrl: `https://shopee.vn/${"z".repeat(3000)}`, subId1: C1, subId2: "26110100001", timeoutMs: 90_000 } as BridgeJob;
    const s = buildServers({ clock: CLOCK, internalToken: INTERNAL, bridgeToken: BRIDGE, internal: [bridgeInternalRoutes({ work: { next: async () => broken, deliver: (result, instance) => (delivered.push([result, instance]), true) } })] });
    servers.push(s);
    const res = await poll(s);
    expect(res.statusCode).toBe(204);
    expect(delivered).toEqual([[{ ticket: broken.ticket, outcome: "failed", reason: "bad_job" }, INSTANCE_A]]);
  });

  it("review 2: a job the bridge takes and never answers is retried once uncounted, then counts as a failed attempt and backs off so the request behind it goes first", async () => {
    const ledger = ledgerWithCustomer();
    const silent = queue(ledger, PRODUCT, fixedClock("2026-11-01T01:00:00.000Z"));
    const behind = queue(ledger, OTHER, fixedClock("2026-11-01T02:00:00.000Z"));
    const { bridge, timer } = bridgeWith();
    const s = internal(bridge);
    const run = () => runLinkJob({ ledger, clock: CLOCK, bridge, subIdPrefix: "", logger: SILENT, effects: linkEffectsFor(CLOCK) }, NEVER);

    const first = run();
    expect(((await poll(s)).json() as BridgeLinkJob).subId2).toBe(silent);
    timer.advance(105_000);
    expect(await first).toEqual({ issued: 0, failed: 0, interrupted: true });
    expect(jobRows(ledger)).toEqual([expect.objectContaining({ request_id: silent, status: "PENDING", no_answers: 1 })]);
    expect(requestRow(ledger, silent).attempts).toBe(0);

    const second = run();
    expect(((await poll(s)).json() as BridgeLinkJob).subId2).toBe(silent);
    timer.advance(105_000);
    await settle();
    const next = (await poll(s)).json() as BridgeLinkJob;
    expect(next.subId2).toBe(behind);
    await answer(s, { ticket: next.ticket, outcome: "link", url: `https://shopee.vn/p?utm_content=${C1}-${behind}---` });
    expect(await second).toEqual({ issued: 1, failed: 1, interrupted: false });
    expect(jobRows(ledger)[0]).toMatchObject({ request_id: silent, status: "FAILED", failure: "bridge_no_answer", no_answers: 2 });
    expect(requestRow(ledger, silent)).toMatchObject({ status: "QUEUED", attempts: 1 });
    expect(requestRow(ledger, silent).next_attempt_at).not.toBeNull();
  });

  it("review 2: with no bridge polling at all, nothing is ever counted", async () => {
    const ledger = ledgerWithCustomer();
    const requestId = queue(ledger, PRODUCT);
    const { bridge, timer } = bridgeWith();
    for (let i = 0; i < 3; i++) {
      const run = runLinkJob({ ledger, clock: CLOCK, bridge, subIdPrefix: "", logger: SILENT, effects: linkEffectsFor(CLOCK) }, NEVER);
      await settle();
      timer.advance(60_000);
      expect(await run).toEqual({ issued: 0, failed: 0, interrupted: true });
    }
    expect(requestRow(ledger, requestId)).toMatchObject({ status: "QUEUED", attempts: 0, next_attempt_at: null });
    expect(jobRows(ledger)).toEqual([expect.objectContaining({ status: "PENDING", no_answers: 0 })]);
  });

  it("review 5: the job out belongs to the instance that took it; another instance gets nothing and its answer is refused", async () => {
    const { bridge, timer } = bridgeWith();
    const s = internal(bridge);
    const link = bridge.submit({ kind: "link", sourceUrl: PRODUCT, subId1: C1, subId2: "26110100001" }, NEVER);
    const job = (await poll(s, as(INSTANCE_A))).json() as BridgeJob;
    const other = poll(s, as(INSTANCE_B));
    await settle();
    timer.advance(25_000);
    expect((await other).statusCode).toBe(204);
    expect((await answer(s, { ticket: job.ticket, outcome: "link", url: "https://s.shopee.vn/B" }, as(INSTANCE_B))).json()).toEqual({ accepted: false });
    expect((await answer(s, { ticket: job.ticket, outcome: "link", url: "https://s.shopee.vn/A" }, as(INSTANCE_A))).json()).toEqual({ accepted: true });
    expect(await link).toEqual({ outcome: "link", url: "https://s.shopee.vn/A" });
    // Without a well-formed instance id the bridge is refused.
    expect((await poll(s, { [BRIDGE_TOKEN_HEADER]: BRIDGE })).statusCode).toBe(400);
    expect((await poll(s, as("not-an-id"))).statusCode).toBe(400);
  });

  it("review 5: the same instance polling again after a restart gets the job back with a fresh answer deadline", async () => {
    const { bridge, timer } = bridgeWith();
    const s = internal(bridge);
    let settled = false;
    const link = bridge.submit({ kind: "link", sourceUrl: PRODUCT, subId1: C1, subId2: "26110100001" }, NEVER).then((a) => ((settled = true), a));
    const job = (await poll(s)).json() as BridgeJob;
    timer.advance(100_000);
    expect((await poll(s)).json()).toEqual(job);
    timer.advance(100_000);
    await settle();
    expect(settled).toBe(false);
    timer.advance(5_000);
    expect(await link).toEqual({ outcome: "unavailable", reason: "no_answer" });
  });

  it("review 6: the pickup wait starts when a job could be handed out, not when it was queued", async () => {
    const { bridge, timer } = bridgeWith();
    const s = internal(bridge);
    const first = bridge.submit({ kind: "link", sourceUrl: PRODUCT, subId1: C1, subId2: "26110100001" }, NEVER);
    const job = (await poll(s)).json() as BridgeJob;
    let secondDone = false;
    const second = bridge.submit({ kind: "link", sourceUrl: OTHER, subId1: C1, subId2: "26110100002" }, NEVER).then((a) => ((secondDone = true), a));
    timer.advance(60_000);
    await settle();
    expect(secondDone).toBe(false);
    await answer(s, { ticket: job.ticket, outcome: "failed", reason: "no_link" });
    await first;
    timer.advance(59_999);
    await settle();
    expect(secondDone).toBe(false);
    timer.advance(1);
    expect(await second).toEqual({ outcome: "unavailable", reason: "no_bridge" });

    // A link job queued ahead of a waiting report page takes the front; the report's wait starts again after it.
    let reportDone = false;
    const report = bridge.submit({ kind: "report", page: 1, purchaseTimeStart: 1_761_955_200, purchaseTimeEnd: 1_762_041_599 }, NEVER).then((a) => ((reportDone = true), a));
    timer.advance(30_000);
    const link = bridge.submit({ kind: "link", sourceUrl: PRODUCT, subId1: C1, subId2: "26110100003" }, NEVER);
    timer.advance(59_999);
    await settle();
    expect(reportDone).toBe(false);
    timer.advance(1);
    expect(await link).toEqual({ outcome: "unavailable", reason: "no_bridge" });
    await settle();
    expect(reportDone).toBe(false);
    timer.advance(60_000);
    expect(await report).toEqual({ outcome: "unavailable", reason: "no_bridge" });
  });
});
