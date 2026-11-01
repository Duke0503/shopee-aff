/**
 * Story 5.2: a repeat request for the same product gives the customer back their own link and
 * never anyone else's; the guest account keeps one link per product (FR-5, D5, D6, D23, INV-1).
 * The golden cases (the 2026-09-25 production defect first) run through `queueLinkRequest` on a
 * migrated ledger; the end-to-end cases go through the assistant's route, the link job and the
 * fake bridge.
 */
import { join } from "node:path";
import { fixedClock, instantFromMs, parseInstant, toMs, type Clock } from "@cashback/core";
import { loadLinkReuseFixtures, type ReuseExistingRequest } from "@cashback/golden/link-reuse";
import { afterEach, describe, expect, it } from "vitest";

import { chooseReusable, claimLinkJob, fakeBridge, isReusable, LINK_REUSE_WINDOW_DAYS, linkRequestInternalRoutes, queueLinkRequest, readShopeeProduct, runLinkJob, shopeeProductKey, unreadableTimes, type ReuseCandidate } from "../src/modules/linking/index";
import { openLedger, type Ledger } from "../src/platform/db/ledger";
import { MIGRATIONS_DIR, readMigrations, runMigrations } from "../src/platform/db/migrations";
import { ASSISTANT_TOKEN_HEADER } from "../src/platform/http/internal-token.guard";
import { buildServers, type Servers } from "../src/platform/http/servers";
import { createLogger } from "../src/platform/log/logger";
import type { BridgePort, LinkBridgeJob } from "../src/platform/ports/bridge.port";
import { tempDir } from "./helpers/live-fixture";

const GOLDEN = loadLinkReuseFixtures();
const NOW = GOLDEN.now;
const CLOCK = fixedClock(NOW);
const SILENT = createLogger({ level: "fatal" });
const A = "1000000000000000001";
const B = "1000000000000000002";
const MERGED = "1000000000000000004";
const P = "https://shopee.vn/Ao-thun-i.166586877.10096389022";
const P_AGAIN = "https://shopee.vn/product/166586877/10096389022?utm_source=chat";
const OTHER = "https://shopee.vn/Quan-i.166586877.10096389099";
const DAY_MS = 86_400_000;
const ASSISTANT = "a".repeat(40);

const ledgers: Ledger[] = [];
const servers: Servers[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await Promise.all([s.publicApp.close(), s.internalApp.close()]);
  for (const l of ledgers.splice(0)) l.close();
});

function seededLedger(): Ledger {
  const ledger = openLedger(join(tempDir("cashback-reuse-"), "ledger.sqlite"));
  runMigrations(ledger, readMigrations(MIGRATIONS_DIR), CLOCK);
  const insert = ledger.sqlite.prepare("INSERT INTO customers (customer_id, customer_code, role, status) VALUES (?, ?, ?, ?)");
  for (const c of GOLDEN.directory.customers) insert.run(c.id, c.code, c.role, c.status);
  for (const [alias, target] of Object.entries(GOLDEN.directory.aliases)) ledger.sqlite.prepare("INSERT INTO customer_aliases (alias, customer_id) VALUES (?, ?)").run(alias, target);
  ledgers.push(ledger);
  return ledger;
}

function addRequest(ledger: Ledger, r: ReuseExistingRequest, origin: "REQUEST" | "CUTOVER" = "REQUEST"): void {
  ledger.sqlite
    .prepare("INSERT INTO link_requests (request_id, customer_id, network, platform, channel, status, source_url, affiliate_url, created_at, origin, product_key) VALUES (?, ?, 'shopee', 'shopee', 'zalo', ?, ?, ?, ?, ?, ?)")
    .run(r.requestId, r.customer, r.status, r.url, r.affiliateUrl, r.createdAt, origin, shopeeProductKey(r.url));
  if (r.shareCode !== null) ledger.sqlite.prepare("INSERT INTO share_codes (code, request_id, created_at) VALUES (?, ?, ?)").run(r.shareCode, r.requestId, r.createdAt);
}

const ask = (ledger: Ledger, customer: string, url = P, clock: Clock = CLOCK, prefix = "") => ledger.tx((db) => queueLinkRequest(db, { customer, url, channel: "zalo" }, clock, prefix));
const count = (ledger: Ledger, table: string) => (ledger.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
const requestOf = (ledger: Ledger, id: string) => ledger.sqlite.prepare("SELECT customer_id, status, affiliate_url, shopee_rate_bps, seller_rate_bps, product_price FROM link_requests WHERE request_id = ?").get(id) as { customer_id: string; status: string; affiliate_url: string | null; shopee_rate_bps: number | null };
const shareCodeOf = (ledger: Ledger, id: string) => (ledger.sqlite.prepare("SELECT code FROM share_codes WHERE request_id = ?").get(id) as { code: string } | undefined)?.code ?? null;

function watchingBridge(): BridgePort & { jobs: LinkBridgeJob[] } {
  const fake = fakeBridge();
  const jobs: LinkBridgeJob[] = [];
  return { mode: "fake", jobs, createLink: async (job, signal) => (jobs.push(job), fake.createLink(job, signal)) };
}

const serve = (ledger: Ledger, bridge: BridgePort, clock: Clock = CLOCK) => runLinkJob({ ledger, clock, bridge, subIdPrefix: "", logger: SILENT }, new AbortController().signal);
const later = (ms: number): Clock => fixedClock(instantFromMs(toMs(parseInstant(NOW)) + ms));

describe("Story 5.2: golden link reuse cases", () => {
  for (const c of GOLDEN.cases) {
    it(`${c.story}: ${c.name}`, () => {
      const ledger = seededLedger();
      for (const r of c.existing) addRequest(ledger, r);
      const before = count(ledger, "link_requests");
      const answer = ask(ledger, c.request.customer, c.request.url);
      expect(answer.customerId).toBe(c.expected.customerId);
      expect(answer.reused).toBe(c.expected.reused);
      if (c.expected.reused) {
        expect(answer).toMatchObject({ requestId: c.expected.requestId, shareCode: c.expected.shareCode });
        expect(count(ledger, "link_requests")).toBe(before);
        return;
      }
      expect(c.existing.map((r) => r.requestId)).not.toContain(answer.requestId);
      expect(requestOf(ledger, answer.requestId)).toMatchObject({ customer_id: c.expected.customerId, status: "QUEUED", affiliate_url: null });
      // The new request's bridge job carries the requester's own sub_id1, never the earlier link's owner.
      const job = ledger.tx((db) => claimLinkJob(db, CLOCK, { subIdPrefix: "", guestIds: ["HOUSE"] }));
      expect(job).toMatchObject({ requestId: answer.requestId, subId1: c.expected.customerId, subId2: answer.requestId });
    });
  }
});

describe("Story 5.2: link reuse only for the same customer and one guest link per product", () => {
  it("AC1: customer A asks again for P inside the window and gets the same share link, with no new bridge job", async () => {
    const ledger = seededLedger();
    const s = buildServers({ clock: CLOCK, internalToken: "i".repeat(40), assistantToken: ASSISTANT, internal: [linkRequestInternalRoutes({ ledger, clock: CLOCK, requestIdPrefix: "" })] });
    servers.push(s);
    const post = (url: string) => s.internalApp.inject({ method: "POST", url: "/internal/link-requests", headers: { [ASSISTANT_TOKEN_HEADER]: ASSISTANT }, payload: { customer: "DP00001", url } });

    const first = (await post(P)).json() as { requestId: string; reused: boolean };
    expect(first).toMatchObject({ status: "QUEUED", reused: false, shareCode: null });
    // Sent again before the link arrives: the same queued request, not a second one.
    expect((await post(P)).json()).toEqual({ requestId: first.requestId, status: "QUEUED", reused: true, shareCode: null });

    const bridge = watchingBridge();
    await serve(ledger, bridge);
    const code = shareCodeOf(ledger, first.requestId);
    expect(code).toMatch(/^[A-Za-z0-9]{10}$/);
    const jobsBefore = count(ledger, "bridge_jobs");

    const again = await post(P_AGAIN);
    expect(again.json()).toEqual({ requestId: first.requestId, status: "ISSUED", reused: true, shareCode: code });
    expect(count(ledger, "link_requests")).toBe(1);
    await serve(ledger, bridge, later(60_000));
    expect(bridge.jobs.map((j) => j.requestId)).toEqual([first.requestId]);
    expect(count(ledger, "bridge_jobs")).toBe(jobsBefore);
  });

  it("AC2: customer B asking for A's product gets a new request and a link with B's own sub_id1, never A's link (the 2026-09-25 case)", async () => {
    const ledger = seededLedger();
    const a = ask(ledger, "DP00001");
    await serve(ledger, fakeBridge());
    const b = ask(ledger, "DP00002");
    expect(b).toMatchObject({ customerId: B, status: "QUEUED", reused: false, shareCode: null });
    expect(b.requestId).not.toBe(a.requestId);

    const bridge = watchingBridge();
    await serve(ledger, bridge);
    expect(bridge.jobs).toEqual([expect.objectContaining({ requestId: b.requestId, subId1: B, subId2: b.requestId })]);
    const linkA = requestOf(ledger, a.requestId).affiliate_url;
    const linkB = requestOf(ledger, b.requestId).affiliate_url;
    expect(linkB).not.toBe(linkA);
    expect(linkB).toContain(`sub_id1=${B}`);
    expect(shareCodeOf(ledger, b.requestId)).not.toBe(shareCodeOf(ledger, a.requestId));
    // And A still gets A's own link back.
    expect(ask(ledger, "DP00001")).toMatchObject({ requestId: a.requestId, reused: true });
  });

  it("AC3: A's link older than the attribution window gives a fresh request with fresh rates", async () => {
    const ledger = seededLedger();
    const old = ask(ledger, "DP00001");
    await serve(ledger, fakeBridge());
    ledger.sqlite.prepare("UPDATE link_requests SET shopee_rate_bps = 300, seller_rate_bps = 500, product_price = 100000 WHERE request_id = ?").run(old.requestId);
    const window = LINK_REUSE_WINDOW_DAYS * DAY_MS;
    expect(LINK_REUSE_WINDOW_DAYS).toBe(7);

    expect(ask(ledger, "DP00001", P, later(window - 1))).toMatchObject({ requestId: old.requestId, reused: true });
    const fresh = ask(ledger, "DP00001", P, later(window + 1));
    expect(fresh).toMatchObject({ reused: false, status: "QUEUED", customerId: A });
    expect(fresh.requestId).not.toBe(old.requestId);
    // Nothing of the old quote is carried over: the rates come from a new lookup (Story 5.6).
    expect(requestOf(ledger, fresh.requestId)).toMatchObject({ shopee_rate_bps: null, seller_rate_bps: null, product_price: null });
    // The old link still works and keeps its own share code (D23: links never expire).
    expect(requestOf(ledger, old.requestId).status).toBe("ISSUED");
  });

  it("AC4: two guest requests for P are served by one HOUSE link, whatever its age", async () => {
    const ledger = seededLedger();
    const first = ask(ledger, "HOUSE");
    const second = ask(ledger, "HOUSE", P_AGAIN);
    expect(second).toMatchObject({ requestId: first.requestId, reused: true });
    const bridge = watchingBridge();
    await serve(ledger, bridge);
    expect(bridge.jobs).toHaveLength(1);
    const code = shareCodeOf(ledger, first.requestId);
    expect(ask(ledger, "HOUSE", P, later(90 * DAY_MS))).toEqual({ requestId: first.requestId, customerId: "HOUSE", status: "ISSUED", reused: true, shareCode: code });
    // Another product is another guest link.
    expect(ask(ledger, "HOUSE", OTHER).reused).toBe(false);
    expect(count(ledger, "link_requests")).toBe(2);
  });

  it("AC5: a request through an alias uses the survivor's links, including one stored under the merged id, and never another customer's", async () => {
    const ledger = seededLedger();
    addRequest(ledger, { requestId: "26103100001", customer: MERGED, url: P, status: "DELIVERED", createdAt: "2026-10-31T01:00:00.000Z", affiliateUrl: "https://s.shopee.vn/OldId", shareCode: "OldIdLink1" });
    addRequest(ledger, { requestId: "26103100002", customer: B, url: P, status: "DELIVERED", createdAt: "2026-10-31T09:00:00.000Z", affiliateUrl: "https://s.shopee.vn/BOnly", shareCode: "BOnlyLink1" });
    // Through the merged id and through the survivor's code: the survivor's own link (sub_id1 = the merged id, which resolves to A).
    expect(ask(ledger, MERGED)).toMatchObject({ requestId: "26103100001", customerId: A, reused: true, shareCode: "OldIdLink1" });
    expect(ask(ledger, "DP00001")).toMatchObject({ requestId: "26103100001", reused: true });
    // An alias that names another live customer's id never pulls that customer's links in.
    ledger.sqlite.prepare("INSERT INTO customer_aliases (alias, customer_id) VALUES (?, ?)").run(B, A);
    expect(ask(ledger, "DP00002")).toMatchObject({ requestId: "26103100002", customerId: B, reused: true });
    const otherProduct = ask(ledger, "DP00001", OTHER);
    expect(otherProduct.reused).toBe(false);
    expect(chooseReusable([{ requestId: "26103100002", customerId: B, status: "DELIVERED", origin: "REQUEST", createdAt: NOW, hasLink: true }], { ownerKeys: [A, MERGED], guest: false, now: CLOCK.now(), requestIdPrefix: "" })).toBeNull();
  });
});

describe("Story 5.2: what is never handed back", () => {
  const rule = { ownerKeys: [A], guest: false, now: CLOCK.now(), requestIdPrefix: "" };
  const candidate = (over: Partial<ReuseCandidate>): ReuseCandidate => ({ requestId: "26103100001", customerId: A, status: "ISSUED", origin: "REQUEST", createdAt: NOW, hasLink: true, ...over });

  it("a FAILED request, an imported request still QUEUED, an unreadable time, or a request of another environment", () => {
    expect(isReusable(candidate({}), rule)).toBe(true);
    expect(isReusable(candidate({ status: "FAILED" }), rule)).toBe(false);
    expect(isReusable(candidate({ status: "QUEUED", origin: "CUTOVER" }), rule)).toBe(false);
    expect(isReusable(candidate({ status: "DELIVERED", origin: "CUTOVER" }), rule)).toBe(true);
    expect(isReusable(candidate({ createdAt: null }), rule)).toBe(false);
    expect(isReusable(candidate({ createdAt: "2026-10-31 10:00:00" }), rule)).toBe(false);
    expect(isReusable(candidate({}), { ...rule, requestIdPrefix: "DEV" })).toBe(false);
    expect(isReusable(candidate({ requestId: "DEV26103100001" }), { ...rule, requestIdPrefix: "DEV" })).toBe(true);
  });

  it("prefers a request that already has its link, then the newest", () => {
    const queued = candidate({ requestId: "26103100009", status: "QUEUED", hasLink: false, createdAt: "2026-11-01T02:00:00.000Z" });
    const issued = candidate({ requestId: "26103100001", createdAt: "2026-10-30T02:00:00.000Z" });
    const newer = candidate({ requestId: "26103100005", createdAt: "2026-10-31T02:00:00.000Z" });
    expect(chooseReusable([queued, issued, newer], rule)?.requestId).toBe("26103100005");
    expect(chooseReusable([queued], rule)?.requestId).toBe("26103100009");
  });

  it("in dev a production request imported for a rehearsal is never handed to a dev requester", () => {
    const ledger = seededLedger();
    addRequest(ledger, { requestId: "26103100001", customer: A, url: P, status: "DELIVERED", createdAt: "2026-10-31T01:00:00.000Z", affiliateUrl: "https://s.shopee.vn/Prod", shareCode: "ProdLink01" }, "CUTOVER");
    const dev = ask(ledger, "DP00001", P, CLOCK, "DEV");
    expect(dev).toMatchObject({ reused: false });
    expect(dev.requestId).toMatch(/^DEV/);
    expect(ask(ledger, "DP00001", P, CLOCK, "DEV")).toMatchObject({ requestId: dev.requestId, reused: true });
  });

  it("names a product by shop and item id in every long form, and keeps it as the short canonical product URL", () => {
    const key = "shopee:166586877.10096389022";
    for (const url of [P, P_AGAIN, "https://shopee.vn/product/166586877/10096389022/", "http://www.shopee.vn/x-i.166586877.10096389022?sp=1#top", "https://shopee.vn/shopname/166586877/10096389022"]) {
      expect(shopeeProductKey(url)).toBe(key);
      expect(readShopeeProduct(url)).toEqual({ ok: true, sourceUrl: "https://shopee.vn/product/166586877/10096389022", productKey: key });
    }
    expect(shopeeProductKey(OTHER)).not.toBe(key);
    expect(shopeeProductKey("https://food.shopee.vn/x-i.1.2")).toBeNull();
    expect(shopeeProductKey("not a link")).toBeNull();
  });
});

describe("Story 5.2 review: only a link that names one product is ever reused", () => {
  it("review 3: a search, the home page, a shop page, a flash sale and a short link get no product key and are never handed back", () => {
    const pages = ["https://shopee.vn/search?keyword=a", "https://shopee.vn/search?keyword=b", "https://shopee.vn/", "https://shopee.vn", "https://shopee.vn/shop/166586877", "https://shopee.vn/flash_sale?promotionId=123456", "https://s.shopee.vn/AbC123"];
    for (const url of pages) expect([url, shopeeProductKey(url)]).toEqual([url, null]);
    const ledger = seededLedger();
    for (const url of pages) {
      const first = ask(ledger, "DP00001", url);
      const again = ask(ledger, "DP00001", url);
      expect(first.reused).toBe(false);
      expect(again.reused).toBe(false);
      expect(again.requestId).not.toBe(first.requestId);
    }
    // Search "a" never hands out the link made for search "b", nor a guest's search link.
    const guestA = ask(ledger, "HOUSE", "https://shopee.vn/search?keyword=a");
    expect(ask(ledger, "HOUSE", "https://shopee.vn/search?keyword=b").requestId).not.toBe(guestA.requestId);
    expect(ask(ledger, "HOUSE", "https://shopee.vn/search?keyword=a").reused).toBe(false);
  });

  it("review 4: migration 0023 keys every request stored before it, so a pre-migration request is reused and the guest keeps one link per product", () => {
    const ledger = openLedger(join(tempDir("cashback-reuse-backfill-"), "ledger.sqlite"));
    ledgers.push(ledger);
    const all = readMigrations(MIGRATIONS_DIR);
    runMigrations(ledger, all.filter((m) => m.id < 23), CLOCK);
    const insert = ledger.sqlite.prepare("INSERT INTO customers (customer_id, customer_code, role, status) VALUES (?, ?, ?, ?)");
    for (const c of GOLDEN.directory.customers) insert.run(c.id, c.code, c.role, c.status);
    const before = ledger.sqlite.prepare("INSERT INTO link_requests (request_id, customer_id, network, platform, channel, status, source_url, affiliate_url, created_at, origin) VALUES (?, ?, 'shopee', 'shopee', 'zalo', ?, ?, ?, ?, ?)");
    before.run("26103100001", A, "DELIVERED", P, "https://s.shopee.vn/OwnA", "2026-10-31T01:00:00.000Z", "REQUEST");
    before.run("26060100001", "HOUSE", "ISSUED", "https://shopee.vn/product/166586877/10096389022", "https://s.shopee.vn/House", "2026-06-01T01:00:00.000Z", "CUTOVER");
    before.run("26103100002", B, "DELIVERED", `xem giup minh ${OTHER} nhe`, "https://s.shopee.vn/OwnB", "2026-10-31T02:00:00.000Z", "CUTOVER");
    before.run("26103100003", B, "DELIVERED", "https://shopee.vn/search?keyword=a", "https://s.shopee.vn/Search", "2026-10-31T02:00:00.000Z", "REQUEST");
    runMigrations(ledger, all, CLOCK);
    const keys = ledger.sqlite.prepare("SELECT request_id, product_key FROM link_requests ORDER BY request_id").all();
    expect(keys).toEqual([
      { request_id: "26060100001", product_key: "shopee:166586877.10096389022" },
      { request_id: "26103100001", product_key: "shopee:166586877.10096389022" },
      { request_id: "26103100002", product_key: "shopee:166586877.10096389099" },
      { request_id: "26103100003", product_key: null },
    ]);
    expect(ask(ledger, "DP00001", P_AGAIN)).toMatchObject({ requestId: "26103100001", reused: true });
    expect(ask(ledger, "HOUSE", P)).toMatchObject({ requestId: "26060100001", reused: true });
    // The whole pasted message of the live system is keyed by the link inside it.
    expect(ask(ledger, "DP00002", OTHER)).toMatchObject({ requestId: "26103100002", reused: true });
    expect(ask(ledger, "DP00001", OTHER).reused).toBe(false);
  });

  it("review 7: a stored time that is not an instant is never reused, sorts after every readable one, and is reported for the log", () => {
    const ledger = seededLedger();
    addRequest(ledger, { requestId: "26103100001", customer: A, url: P, status: "DELIVERED", createdAt: "31/10/2026 10:00", affiliateUrl: "https://s.shopee.vn/Odd", shareCode: "OddTime001" });
    const notes: unknown[] = [];
    const answer = ledger.tx((db) => queueLinkRequest(db, { customer: "DP00001", url: P, channel: "zalo" }, CLOCK, "", (event, detail) => void notes.push([event, detail])));
    expect(answer.reused).toBe(false);
    expect(notes).toEqual([["linking.link_reuse.unreadable_time", { requestIds: ["26103100001"] }]]);

    const rule = { ownerKeys: ["HOUSE"], guest: true, now: CLOCK.now(), requestIdPrefix: "" };
    const odd: ReuseCandidate = { requestId: "26103100009", customerId: "HOUSE", status: "ISSUED", origin: "CUTOVER", createdAt: "2026-10-31 10:00:00", hasLink: true };
    const fine: ReuseCandidate = { ...odd, requestId: "26060100001", createdAt: "2026-06-01T01:00:00.000Z" };
    expect(chooseReusable([odd, fine], rule)?.requestId).toBe("26060100001");
    expect(chooseReusable([odd], rule)).toBeNull();
    expect(unreadableTimes([odd, fine], rule)).toEqual(["26103100009"]);
  });
});
