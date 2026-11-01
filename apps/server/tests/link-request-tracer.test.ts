/**
 * Story 5.1: a link request becomes an ISSUED link with a share code through the fake bridge
 * (AD-14, AD-15, AD-25, D6, D7, D47, INV-1), and the review of Sprint 20: a failing request never
 * starves the queue, shutdown is not a failure, a resumed job is checked again, and a returned
 * link is attached only when it carries the job's own sub_ids.
 */
import { join } from "node:path";
import { fixedClock, instantFromMs, parseInstant, toMs, type Clock } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";

import { linkBridge, linkEffectsFor, linkJobs, linkRoutes, subIdPrefixFor } from "../src/links/link-jobs";
import { checkReturnedLink, claimLinkJob, fakeBridge, FAKE_BRIDGE_HOST, findShareCode, LinkRequestError, linkRequestInternalRoutes, nextRequestId, queueLinkRequest, recordLinkResult, retryDelayMs, runLinkJob, shopeeProductUrl, type LinkChannel, type RecordedBridgeAnswer } from "../src/modules/linking/index";
import { parseConfig } from "../src/platform/config/env.config";
import { openLedger, type Ledger } from "../src/platform/db/ledger";
import { MIGRATIONS_DIR, readMigrations, runMigrations } from "../src/platform/db/migrations";
import { ASSISTANT_TOKEN_HEADER, INTERNAL_TOKEN_HEADER } from "../src/platform/http/internal-token.guard";
import { buildServers, type InternalRoutes, type Servers } from "../src/platform/http/servers";
import { createLogger } from "../src/platform/log/logger";
import type { BridgeLinkResult, BridgePort, LinkBridgeJob } from "../src/platform/ports/bridge.port";
import { tempDir } from "./helpers/live-fixture";

const START = "2026-11-01T03:00:00.000Z";
const CLOCK = fixedClock(START);
const INTERNAL = "i".repeat(40);
const ASSISTANT = "a".repeat(40);
const PRODUCT = "https://shopee.vn/Ao-thun-i.11001.22001";
const SILENT = createLogger({ level: "fatal" });
const ALNUM = /^[A-Za-z0-9]+$/;
const C1 = "1000000000000000001";
const C2 = "1000000000000000002";
const NO_GUESTS = { subIdPrefix: "", guestIds: ["HOUSE"] };

const ledgers: Ledger[] = [];
const servers: Servers[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await Promise.all([s.publicApp.close(), s.internalApp.close()]);
  for (const l of ledgers.splice(0)) l.close();
});

function ledgerWithCustomers(): Ledger {
  const ledger = openLedger(join(tempDir("cashback-links-"), "ledger.sqlite"));
  runMigrations(ledger, readMigrations(MIGRATIONS_DIR), CLOCK);
  ledger.sqlite.exec(`INSERT INTO customers (customer_id, customer_code, role, status) VALUES
    ('${C1}', 'DP00001', 'USER', 'ACTIVE'), ('${C2}', 'DP00002', 'USER', 'ACTIVE'), ('1000000000000000003', 'DP00003', 'USER', 'DISABLED'), ('HOUSE', NULL, 'HOUSE', 'ACTIVE')`);
  ledgers.push(ledger);
  return ledger;
}

function internalApp(ledger: Ledger, assistantToken: string | null = ASSISTANT, routes?: InternalRoutes[]): Servers {
  const s = buildServers({ clock: CLOCK, internalToken: INTERNAL, assistantToken, internal: routes ?? [linkRequestInternalRoutes({ ledger, clock: CLOCK, requestIdPrefix: "" })] });
  servers.push(s);
  return s;
}

const post = (s: Servers, headers: Record<string, string>, payload: object = { customer: "DP00001", url: PRODUCT }) => s.internalApp.inject({ method: "POST", url: "/internal/link-requests", headers, payload });
const queue = (ledger: Ledger, customer: string, channel: LinkChannel, clock: Clock = CLOCK) => ledger.tx((db) => queueLinkRequest(db, { customer, url: PRODUCT, channel }, clock)).requestId;

interface RequestRow {
  status: string;
  affiliate_url: string | null;
  customer_id: string;
  channel: string;
  attempts: number;
  next_attempt_at: string | null;
}
const requestRow = (ledger: Ledger, id: string) => ledger.sqlite.prepare("SELECT status, affiliate_url, customer_id, channel, attempts, next_attempt_at FROM link_requests WHERE request_id = ?").get(id) as RequestRow;
const jobRows = (ledger: Ledger) => ledger.sqlite.prepare("SELECT kind, status, request_id, customer_id, sub_id1, sub_id2, failure FROM bridge_jobs ORDER BY job_id").all() as { kind: string; status: string; request_id: string; customer_id: string; sub_id1: string; sub_id2: string; failure: string | null }[];
const shareCodeCount = (ledger: Ledger) => (ledger.sqlite.prepare("SELECT count(*) AS n FROM share_codes").get() as { n: number }).n;

/** A bridge that records what it was handed and answers with `answer` (the fake bridge by default). */
function watchingBridge(answer?: (job: LinkBridgeJob) => BridgeLinkResult, mode: BridgePort["mode"] = "fake"): BridgePort & { jobs: LinkBridgeJob[] } {
  const fake = fakeBridge();
  const jobs: LinkBridgeJob[] = [];
  return { mode, jobs, createLink: async (job, signal) => (jobs.push(job), answer ? answer(job) : fake.createLink(job, signal)) };
}

/** A clock the test moves. */
function movingClock(start = START): Clock & { advance(ms: number): void } {
  let now = toMs(parseInstant(start));
  return { now: () => instantFromMs(now), advance: (ms) => void (now += ms) };
}

const run = (ledger: Ledger, bridge: BridgePort, clock: Clock = CLOCK, signal: AbortSignal = new AbortController().signal) => runLinkJob({ ledger, clock, bridge, subIdPrefix: "", logger: SILENT, effects: linkEffectsFor(clock) }, signal);

describe("Story 5.1: link request to share link through the fake bridge", () => {
  it("AC1: a known customer's Shopee link is QUEUED by the assistant, then ISSUED with a 10-character base62 share code", async () => {
    const ledger = ledgerWithCustomers();
    const res = await post(internalApp(ledger), { [ASSISTANT_TOKEN_HEADER]: ASSISTANT });
    expect(res.statusCode).toBe(200);
    const { requestId, status } = res.json() as { requestId: string; status: string };
    expect(status).toBe("QUEUED");
    expect(requestRow(ledger, requestId)).toMatchObject({ status: "QUEUED", customer_id: C1, channel: "zalo", affiliate_url: null });

    expect(await run(ledger, fakeBridge())).toEqual({ issued: 1, failed: 0, interrupted: false });
    const issued = requestRow(ledger, requestId);
    expect(issued.status).toBe("ISSUED");
    expect(new URL(issued.affiliate_url ?? "").hostname).toBe(FAKE_BRIDGE_HOST);
    const { code } = ledger.sqlite.prepare("SELECT code FROM share_codes WHERE request_id = ?").get(requestId) as { code: string };
    expect(code).toMatch(/^[A-Za-z0-9]{10}$/);
    expect(findShareCode(ledger.db, code)).toEqual({ code, requestId, customerId: C1, affiliateUrl: issued.affiliate_url });
    expect(jobRows(ledger)).toEqual([expect.objectContaining({ kind: "LINK", status: "DONE", request_id: requestId })]);
    expect(await run(ledger, fakeBridge())).toEqual({ issued: 0, failed: 0, interrupted: false });
  });

  it("AC2: the bridge job carries exactly one customer, sub_id1 = that customer's id and sub_id2 = the request id, both [a-zA-Z0-9]+", async () => {
    const ledger = ledgerWithCustomers();
    const first = queue(ledger, "DP00001", "zalo");
    const second = queue(ledger, "DP00002", "zalo");
    const bridge = watchingBridge();
    await run(ledger, bridge);
    expect(bridge.jobs.map((j) => [j.requestId, j.subId1, j.subId2])).toEqual([
      [first, C1, first],
      [second, C2, second],
    ]);
    for (const job of jobRows(ledger)) {
      expect(job.sub_id1).toMatch(ALNUM);
      expect(job.sub_id2).toMatch(ALNUM);
      expect(job.sub_id1).toBe(job.customer_id);
      expect(job.sub_id2).toBe(job.request_id);
    }
    // The table itself refuses a job that pairs one request with another customer's sub_id1 or another request's sub_id2.
    const insert = ledger.sqlite.prepare("INSERT INTO bridge_jobs (kind, status, request_id, customer_id, sub_id1, sub_id2, source_url, created_at) VALUES ('LINK', 'PENDING', ?, ?, ?, ?, 'u', 't')");
    expect(() => insert.run(first, C1, C2, first)).toThrow(/CHECK/);
    expect(() => insert.run(first, C1, C1, second)).toThrow(/CHECK/);
    expect(() => insert.run(first, C1, C1, "a-b")).toThrow(/CHECK/);
  });

  it("AC3: with Zalo, web and guest requests queued together, the Zalo request is served first, then web, then the guest", () => {
    const ledger = ledgerWithCustomers();
    const guest = queue(ledger, "HOUSE", "web", fixedClock("2026-11-01T01:00:00.000Z"));
    const web = queue(ledger, "DP00002", "web", fixedClock("2026-11-01T02:00:00.000Z"));
    const zalo = queue(ledger, "DP00001", "zalo", fixedClock("2026-11-01T02:30:00.000Z"));
    const served: string[] = [];
    for (let i = 0; i < 3; i++) {
      const job = ledger.tx((db) => claimLinkJob(db, CLOCK, NO_GUESTS));
      if (job === null) throw new Error("expected a job");
      served.push(job.requestId);
      ledger.tx((db) => recordLinkResult(db, job, fakeBridgeAnswer(job), CLOCK, { acceptFakeHost: true, effects: linkEffectsFor(CLOCK) }));
    }
    expect(served).toEqual([zalo, web, guest]);
    expect(ledger.tx((db) => claimLinkJob(db, CLOCK, NO_GUESTS))).toBeNull();
  });

  it("AC4: with the dev configuration the link's sub_id1 starts with DEV, and so does the request id", async () => {
    const ledger = ledgerWithCustomers();
    const dev = parseConfig("dev", { INTERNAL_TOKEN: INTERNAL, ASSISTANT_TOKEN: ASSISTANT });
    // One bridge for the routes and the job, as the composition root builds it.
    const bridge = linkBridge(dev);
    const res = await post(internalApp(ledger, ASSISTANT, linkRoutes({ config: dev, ledger, clock: CLOCK, logger: SILENT }, bridge)), { [ASSISTANT_TOKEN_HEADER]: ASSISTANT });
    const { requestId } = res.json() as { requestId: string };
    expect(requestId).toBe("DEV26110100001");
    const [job] = linkJobs({ config: dev, ledger, clock: CLOCK, logger: SILENT }, bridge);
    await job?.run(new AbortController().signal);
    expect(jobRows(ledger)).toEqual([expect.objectContaining({ request_id: requestId, sub_id1: `DEV${C1}`, sub_id2: requestId, status: "DONE" })]);
    expect(requestRow(ledger, requestId).affiliate_url).toContain(`sub_id1=DEV${C1}`);
    expect(subIdPrefixFor("prod")).toBe("");
    expect(() => linkBridge({ env: "prod", bridgeMode: "fake" })).toThrow(/never runs in production/);
  });

  it("AC5: a request without the assistant token, with the internal token instead or with a wrong one, returns 401", async () => {
    const ledger = ledgerWithCustomers();
    const s = internalApp(ledger);
    expect((await post(s, {})).statusCode).toBe(401);
    expect((await post(s, { [INTERNAL_TOKEN_HEADER]: INTERNAL })).statusCode).toBe(401);
    expect((await post(s, { [ASSISTANT_TOKEN_HEADER]: "b".repeat(40) })).statusCode).toBe(401);
    expect((await post(s, { [ASSISTANT_TOKEN_HEADER]: ASSISTANT.slice(1) })).statusCode).toBe(401);
    expect((await post(internalApp(ledger, null), { [ASSISTANT_TOKEN_HEADER]: ASSISTANT })).statusCode).toBe(401);
    // The assistant token opens only the assistant's route.
    expect((await s.internalApp.inject({ method: "GET", url: "/internal/ping", headers: { [ASSISTANT_TOKEN_HEADER]: ASSISTANT } })).statusCode).toBe(401);
    expect(ledger.sqlite.prepare("SELECT count(*) AS n FROM link_requests").get()).toEqual({ n: 0 });
  });

  it("refuses an unknown customer (404), a disabled customer (403, review item 9) and a link that is not a Shopee product (400), queueing nothing", async () => {
    const ledger = ledgerWithCustomers();
    const s = internalApp(ledger);
    const headers = { [ASSISTANT_TOKEN_HEADER]: ASSISTANT };
    const unknown = await post(s, headers, { customer: "DP99999", url: PRODUCT });
    expect([unknown.statusCode, unknown.json()]).toEqual([404, { error: { code: "not_found", messageKey: "error.link.customer_not_found" } }]);
    const disabled = await post(s, headers, { customer: "DP00003", url: PRODUCT });
    expect([disabled.statusCode, disabled.json()]).toEqual([403, { error: { code: "forbidden", messageKey: "error.link.customer_disabled" } }]);
    const lazada = await post(s, headers, { customer: "DP00001", url: "https://www.lazada.vn/products/x-i1.html" });
    expect([lazada.statusCode, lazada.json()]).toEqual([400, { error: { code: "invalid_request", messageKey: "error.link.network_unsupported" } }]);
    expect((await post(s, headers, { customer: "DP00001" })).statusCode).toBe(400);
    expect(ledger.sqlite.prepare("SELECT count(*) AS n FROM link_requests").get()).toEqual({ n: 0 });
  });

  it("request ids keep the live YYMMDD form, continue above an imported id of the same Vietnam day, and carry DEV in dev", () => {
    const ledger = ledgerWithCustomers();
    ledger.sqlite.exec(`INSERT INTO link_requests (request_id, customer_id, platform, status, source_url, origin) VALUES ('26110100041', '${C1}', 'shopee', 'DELIVERED', 'u', 'CUTOVER')`);
    expect(queue(ledger, "DP00001", "zalo")).toBe("26110100042");
    expect(ledger.tx((db) => nextRequestId(db, fixedClock("2026-11-01T17:30:00.000Z")))).toBe("26110200001");
    expect(ledger.tx((db) => queueLinkRequest(db, { customer: "DP00001", url: PRODUCT, channel: "zalo" }, CLOCK, "DEV")).requestId).toBe("DEV26110100001");
    expect(ledger.tx((db) => nextRequestId(db, CLOCK, "DEV"))).toBe("DEV26110100002");
  });

  it("recognises Shopee product links on every Shopee domain and nothing else", () => {
    for (const url of [PRODUCT, "https://s.shopee.vn/AbC123", "https://shope.ee/x", "https://vn.shp.ee/y", "http://shopee.vn/product/1/2"]) expect(shopeeProductUrl(url)).not.toBeNull();
    for (const url of ["https://food.shopee.vn/x", "https://shopee.vn/now-food/x", "https://shopee.vn.evil.com/x", "https://notshopee.vn/x", "javascript:alert(1)", "ftp://shopee.vn/x", "https://u:p@shopee.vn/x", ""]) expect(shopeeProductUrl(url)).toBeNull();
    expect(() => ledgerWithCustomers().tx((db) => queueLinkRequest(db, { customer: "DP00001", url: "https://www.lazada.vn/products/x-i1.html", channel: "zalo" }, CLOCK))).toThrow(LinkRequestError);
  });
});

const fakeBridgeAnswer = (job: LinkBridgeJob): RecordedBridgeAnswer => ({ outcome: "link", url: `https://${FAKE_BRIDGE_HOST}/l/${job.subId2}?sub_id1=${job.subId1}&sub_id2=${job.subId2}` });

describe("Story 5.1 review: no customer's link is lost or given to someone else", () => {
  it("review 1: a request that keeps failing backs off with a growing delay and never starves the requests behind it", async () => {
    const ledger = ledgerWithCustomers();
    const clock = movingClock();
    const failing = queue(ledger, "DP00001", "zalo", fixedClock("2026-11-01T02:00:00.000Z"));
    const behind = queue(ledger, "DP00002", "zalo", fixedClock("2026-11-01T02:30:00.000Z"));
    const bridge = watchingBridge((job) => (job.requestId === failing ? { outcome: "failed", reason: "page_error" } : fakeBridgeAnswer(job)));

    expect(await run(ledger, bridge, clock)).toEqual({ issued: 1, failed: 1, interrupted: false });
    expect(requestRow(ledger, behind).status).toBe("ISSUED");
    expect(requestRow(ledger, failing)).toMatchObject({ status: "QUEUED", attempts: 1, next_attempt_at: instantFromMs(toMs(clock.now()) + retryDelayMs(1)) });

    // Not due yet: the next run hands nothing to the bridge.
    expect(await run(ledger, bridge, clock)).toEqual({ issued: 0, failed: 0, interrupted: false });
    clock.advance(retryDelayMs(1));
    expect(await run(ledger, bridge, clock)).toEqual({ issued: 0, failed: 1, interrupted: false });
    expect(requestRow(ledger, failing)).toMatchObject({ status: "QUEUED", attempts: 2, next_attempt_at: instantFromMs(toMs(clock.now()) + retryDelayMs(2)) });
    expect(retryDelayMs(2)).toBeGreaterThan(retryDelayMs(1));
    expect(retryDelayMs(50)).toBe(15 * 60_000);

    // A new request queued while the first is backing off is served at once.
    // Another product: the same product would hand back DP00002's own issued link (Story 5.2).
    const later = ledger.tx((db) => queueLinkRequest(db, { customer: "DP00002", url: "https://shopee.vn/Quan-i.11001.22002", channel: "zalo" }, clock)).requestId;
    expect(await run(ledger, bridge, clock)).toEqual({ issued: 1, failed: 0, interrupted: false });
    expect(requestRow(ledger, later).status).toBe("ISSUED");
  });

  it("review 2: a shutdown during the bridge call leaves the job open and uncounted, and the next start sends it again", async () => {
    const ledger = ledgerWithCustomers();
    const requestId = queue(ledger, "DP00001", "zalo");
    const controller = new AbortController();
    const hanging: BridgePort = {
      mode: "fake",
      createLink: (_job, signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
    };
    const running = run(ledger, hanging, CLOCK, controller.signal);
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();
    expect(await running).toEqual({ issued: 0, failed: 0, interrupted: true });
    expect(jobRows(ledger)).toEqual([expect.objectContaining({ status: "PENDING", request_id: requestId })]);
    expect(requestRow(ledger, requestId)).toMatchObject({ status: "QUEUED", attempts: 0, next_attempt_at: null });

    const bridge = watchingBridge();
    expect(await run(ledger, bridge)).toEqual({ issued: 1, failed: 0, interrupted: false });
    expect(bridge.jobs.map((j) => j.requestId)).toEqual([requestId]);
    expect(jobRows(ledger)).toHaveLength(1);
  });

  it("review 3: a resumed open job is checked again; an erased customer's or a settled request's job is closed without reaching the bridge", async () => {
    const ledger = ledgerWithCustomers();
    const erased = queue(ledger, "DP00001", "zalo");
    ledger.tx((db) => claimLinkJob(db, CLOCK, NO_GUESTS));
    ledger.sqlite.exec(`UPDATE customers SET status = 'ERASED' WHERE customer_id = '${C1}'`);
    const bridge = watchingBridge();
    await run(ledger, bridge);
    expect(bridge.jobs).toEqual([]);
    expect(jobRows(ledger)).toEqual([expect.objectContaining({ request_id: erased, status: "FAILED", failure: "stale" })]);
    expect(requestRow(ledger, erased)).toMatchObject({ status: "FAILED", affiliate_url: null });

    const settled = queue(ledger, "DP00002", "zalo");
    ledger.tx((db) => claimLinkJob(db, CLOCK, NO_GUESTS));
    ledger.sqlite.exec(`UPDATE link_requests SET status = 'ISSUED' WHERE request_id = '${settled}'`);
    await run(ledger, bridge);
    expect(bridge.jobs).toEqual([]);
    expect(jobRows(ledger).at(-1)).toMatchObject({ request_id: settled, status: "FAILED", failure: "stale" });
    expect(shareCodeCount(ledger)).toBe(0);
  });

  it("review 3: a queued request whose customer was erased before its first claim never reaches the bridge", async () => {
    const ledger = ledgerWithCustomers();
    const requestId = queue(ledger, "DP00002", "web");
    ledger.sqlite.exec(`UPDATE customers SET status = 'ERASED' WHERE customer_id = '${C2}'`);
    const bridge = watchingBridge();
    await run(ledger, bridge);
    expect(bridge.jobs).toEqual([]);
    expect(requestRow(ledger, requestId).status).toBe("FAILED");
  });

  it("review 4: a returned link that does not carry the job's own sub_id1 and sub_id2 is never attached", async () => {
    const wrongCustomer = (job: LinkBridgeJob): BridgeLinkResult => ({ outcome: "link", url: `https://${FAKE_BRIDGE_HOST}/l/x?sub_id1=${C2}&sub_id2=${job.subId2}` });
    const wrongRequest = (job: LinkBridgeJob): BridgeLinkResult => ({ outcome: "link", url: `https://${FAKE_BRIDGE_HOST}/l/x?sub_id1=${job.subId1}&sub_id2=26110199999` });
    const shopeeMismatch = (job: LinkBridgeJob): BridgeLinkResult => ({ outcome: "link", url: `https://shopee.vn/p-i.1.2?utm_content=${C2}-${job.subId2}---` });
    const shortUnresolved = (): BridgeLinkResult => ({ outcome: "link", url: "https://s.shopee.vn/AbC123", resolvedUrl: "https://shopee.vn/p-i.1.2" });
    const otherHost = (job: LinkBridgeJob): BridgeLinkResult => ({ outcome: "link", url: `https://evil.example/l?sub_id1=${job.subId1}&sub_id2=${job.subId2}` });
    const cases: [string, (job: LinkBridgeJob) => BridgeLinkResult, BridgePort["mode"]][] = [
      ["link_sub_ids_mismatch", wrongCustomer, "fake"],
      ["link_sub_ids_mismatch", wrongRequest, "fake"],
      ["link_sub_ids_mismatch", shopeeMismatch, "browser"],
      ["link_sub_ids_unverified", shortUnresolved, "browser"],
      ["link_host_not_allowed", otherHost, "browser"],
      ["link_host_not_allowed", fakeBridgeAnswer, "browser"],
    ];
    for (const [reason, answer, mode] of cases) {
      const ledger = ledgerWithCustomers();
      const requestId = queue(ledger, "DP00001", "zalo");
      expect(await run(ledger, watchingBridge(answer, mode))).toEqual({ issued: 0, failed: 1, interrupted: false });
      expect(jobRows(ledger)).toEqual([expect.objectContaining({ status: "FAILED", failure: reason })]);
      expect(requestRow(ledger, requestId)).toMatchObject({ status: "QUEUED", affiliate_url: null, attempts: 1 });
      expect(shareCodeCount(ledger)).toBe(0);
    }
  });

  it("review 4: a Shopee link is attached when it, or its resolved short link, carries the job's sub_ids in utm_content", async () => {
    const long = (job: LinkBridgeJob): BridgeLinkResult => ({ outcome: "link", url: `https://shopee.vn/p-i.1.2?utm_source=an&utm_content=${job.subId1}-${job.subId2}---` });
    // The bridge answers a short link with its target as the real browser resolved it (Story 5.4 review item 3).
    const resolvedShort = (job: LinkBridgeJob): BridgeLinkResult => ({ outcome: "link", url: "https://s.shopee.vn/AbC123", resolvedUrl: `https://shopee.vn/p-i.1.2?utm_content=${job.subId1}-${job.subId2}---` });
    for (const answer of [long, resolvedShort]) {
      const ledger = ledgerWithCustomers();
      const requestId = queue(ledger, "DP00001", "zalo");
      expect(await run(ledger, watchingBridge(answer, "browser"))).toEqual({ issued: 1, failed: 0, interrupted: false });
      expect(requestRow(ledger, requestId).status).toBe("ISSUED");
    }
    expect(checkReturnedLink({ url: "https://s.shopee.vn/AbC", resolvedUrl: `https://evil.example/?utm_content=${C1}-R1`, subId1: C1, subId2: "R1", acceptFakeHost: false })).toEqual({ ok: false, reason: "host_not_allowed" });
    expect(checkReturnedLink({ url: `http://shopee.vn/?utm_content=${C1}-R1`, subId1: C1, subId2: "R1", acceptFakeHost: false })).toEqual({ ok: false, reason: "not_a_link" });
  });
});
