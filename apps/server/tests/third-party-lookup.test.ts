/**
 * The third party asked first for a product's facts (owner decision 2026-11-02, the live order
 * since 1819487; live `third_party_lookup.py` and `tests/test_commission.py`). The HTTP call is a
 * fake: nothing here reaches addlivetag, the VPS or Shopee. The answers have the live response
 * shape (`status`, `productInfo` with `itemId`, `productName`, `price`, `commission`,
 * `totalRatePercent`, `sellerRatePercent`, `shopeeRatePercent`, `cap`, `isCapped`, `isXtra`,
 * `lastUpdate`, `imageUrl`, and the `legalNotice` block).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixedClock } from "@cashback/core";
import { shopeeEstimate } from "@cashback/money";
import { afterEach, describe, expect, it } from "vitest";

import { carryOverStep } from "../src/cutover/cutover-steps";
import { preflightVerdict } from "../src/cutover/cutover-preflight";
import { CARRIED_SECRET_KEYS, planCarryOver } from "../src/cutover/env-carry-over";
import { SECRET_KEYS } from "../src/host/secrets-check";
import { environmentModes, linkEffectsFor, thirdPartyLookupFor } from "../src/links/link-jobs";
import { ADDLIVETAG_API_URL, ADDLIVETAG_TIMEOUT_MS, addlivetagLookup, fakeBridge, linkReplyData, readThirdPartyAnswer, runProductLookups, type ThirdPartyLookup } from "../src/modules/linking/index";
import type { HttpAnswer, HttpGet } from "../src/modules/linking/accesstrade-api.adapter";
import { ConfigError, parseConfig, REPOSITORY_ROOT } from "../src/platform/config/env.config";
import { isolationProblems, isolationWarnings, productionIdentifiers, type IsolationContext } from "../src/platform/config/isolation.config";
import type { Ledger } from "../src/platform/db/ledger";
import type { Logger } from "../src/platform/log/logger";
import type { BridgeLookupResult, BridgePort, LookupBridgeJob } from "../src/platform/ports/bridge.port";
import { C1, LINK_START, linkLedger, memoryLogger, queueLink, runLinks, SILENT } from "./helpers/link-ledger";
import { tempDir } from "./helpers/live-fixture";

const ledgers: Ledger[] = [];
afterEach(() => {
  for (const l of ledgers.splice(0)) l.close();
});

const KEY = "test-addlivetag-key-0000000000000000";
/** Live item 43733512926: 4% + 10% according to addlivetag (live commit 1819487). */
const PRODUCT = "https://shopee.vn/Ao-khoac-i.11001.43733512926";
const ITEM = "43733512926";

const body = (info: Record<string, unknown>): unknown => ({
  status: "success",
  productInfo: { itemId: ITEM, productName: "Ao khoac gio nam", shopName: "Shop A", price: 242250, commission: 33915, totalRatePercent: 14, sellerRatePercent: 10, shopeeRatePercent: 4, cap: null, isCapped: false, isXtra: true, lastUpdate: "2026-10-17 09:00:00", imageUrl: "https://down-vn.img.susercontent.com/file/abc", ...info },
  legalNotice: { purpose: "for_education_research_internal_non_commercial", nonCommercialOnly: true },
});

interface Call {
  url: string;
  headers: Readonly<Record<string, string>>;
}

/** A fake GET that records each call and answers `answer` (a body, a status, a throw or a hang). */
function fakeGet(answer: () => Promise<HttpAnswer> | HttpAnswer): HttpGet & { calls: Call[] } {
  const calls: Call[] = [];
  const get: HttpGet = async (url, headers) => (calls.push({ url, headers }), answer());
  return Object.assign(get, { calls });
}
const ok = (json: unknown): HttpAnswer => ({ status: 200, json: async () => json });

/** A fake bridge whose lookups answer `answer` and are recorded. */
function lookupBridge(answer: BridgeLookupResult): BridgePort & { lookups: LookupBridgeJob[] } {
  const fake = fakeBridge();
  const lookups: LookupBridgeJob[] = [];
  return { mode: "fake", lookups, createLink: fake.createLink, lookupProduct: async (job) => (lookups.push(job), answer) };
}
const PAGES: BridgeLookupResult = { outcome: "value", value: { found: true, shopId: "11001", itemId: ITEM, name: "Ao khoac", imageUrl: null, priceText: "242.250", rates: { commissionTexts: ["8,5%"], xtraTexts: ["XTRA 3%"] } } };

const lookups = (ledger: Ledger, bridge: BridgePort, thirdParty: ThirdPartyLookup | null, logger: Logger = SILENT) => {
  const clock = fixedClock(LINK_START);
  return runProductLookups({ ledger, clock, bridge, logger, effects: linkEffectsFor(clock), thirdParty }, new AbortController().signal);
};

async function issued(ledger: Ledger, bridge: BridgePort, url = PRODUCT): Promise<string> {
  const id = queueLink(ledger, C1, url);
  await runLinks(ledger, bridge);
  return id;
}

const snapshot = (ledger: Ledger, id: string) =>
  ledger.sqlite.prepare("SELECT product_price, shopee_rate_bps, seller_rate_bps, estimated_commission, estimate_source, product_name FROM link_requests WHERE request_id = ?").get(id) as Record<string, unknown>;

describe("the third-party request mirrors the live lookup", () => {
  it("GET product-data.php with item_id and key in the query and X-API-Key, 12 s timeout", async () => {
    const get = fakeGet(() => ok(body({})));
    const answer = await addlivetagLookup({ apiKey: KEY, get }).lookup(ITEM, new AbortController().signal);
    expect(ADDLIVETAG_TIMEOUT_MS).toBe(12_000);
    expect(get.calls).toHaveLength(1);
    const url = new URL(get.calls[0]?.url ?? "");
    expect(`${url.origin}${url.pathname}`).toBe(ADDLIVETAG_API_URL);
    expect(Object.fromEntries(url.searchParams)).toEqual({ item_id: ITEM, key: KEY });
    expect(get.calls[0]?.headers["X-API-Key"]).toBe(KEY);
    expect(answer).toEqual({ ok: true, facts: { productOfferId: ITEM, name: "Ao khoac gio nam", imageUrl: "https://down-vn.img.susercontent.com/file/abc", price: 242_250, shopeeRateBps: 400, sellerRateBps: 1000 } });
  });

  it("an error status, a network error, a body that is not JSON and a hang that passes the timeout are reason codes, never throws", async () => {
    const signal = new AbortController().signal;
    const ask = (get: HttpGet) => addlivetagLookup({ apiKey: KEY, get, timeoutMs: 20 }).lookup(ITEM, signal);
    expect(await ask(fakeGet(() => ({ status: 401, json: async () => ({}) })))).toEqual({ ok: false, reason: "http_401" });
    expect(await ask(fakeGet(() => Promise.reject(new TypeError("fetch failed"))))).toEqual({ ok: false, reason: "network" });
    expect(await ask(fakeGet(() => ({ status: 200, json: () => Promise.reject(new SyntaxError("Unexpected token")) })))).toEqual({ ok: false, reason: "not_json" });
    expect(await ask(fakeGet(() => new Promise<HttpAnswer>(() => undefined)))).toEqual({ ok: false, reason: "timeout" });
  });

  it("an unusable or ambiguous answer is refused, never read as a figure", () => {
    const read = (info: Record<string, unknown>) => readThirdPartyAnswer(body(info), ITEM);
    expect(readThirdPartyAnswer({ status: "error" }, ITEM)).toEqual({ ok: false, reason: "not_success" });
    expect(read({ itemId: "", productName: "" })).toEqual({ ok: false, reason: "not_found" });
    expect(read({ itemId: "999" })).toEqual({ ok: false, reason: "other_item" });
    for (const price of [0, "100.000 - 200.000", 242250.5, null]) expect(read({ price })).toEqual({ ok: false, reason: "bad_price" });
    expect(read({ totalRatePercent: 15 })).toEqual({ ok: false, reason: "bad_rates" });
    expect(read({ shopeeRatePercent: "4,5" })).toEqual({ ok: false, reason: "bad_rates" });
    expect(read({ shopeeRatePercent: 2.555 })).toEqual({ ok: false, reason: "bad_rates" });
    expect(read({ sellerRatePercent: 0, totalRatePercent: 4 })).toEqual({ ok: false, reason: "bad_rates" });
    expect(read({ shopeeRatePercent: 0, sellerRatePercent: 0, totalRatePercent: 0, isXtra: false })).toEqual({ ok: false, reason: "no_rates" });
    expect(read({ shopeeRatePercent: "2.5", sellerRatePercent: "7", totalRatePercent: 9.5, price: "97500" })).toMatchObject({ ok: true, facts: { price: 97_500, shopeeRateBps: 250, sellerRateBps: 700 } });
    expect(read({ imageUrl: "http://plain/img" })).toMatchObject({ ok: true, facts: { imageUrl: null } });
  });
});

describe("the third party first, the bridge second", () => {
  it("usable facts become the snapshot (third_party) and the bridge is not asked; money golden: 242,250 at 4% + 10% is 33,915", async () => {
    const ledger = linkLedger(ledgers);
    const bridge = lookupBridge(PAGES);
    const id = await issued(ledger, bridge);
    expect(await lookups(ledger, bridge, addlivetagLookup({ apiKey: KEY, get: fakeGet(() => ok(body({}))) }))).toBe(1);
    expect(bridge.lookups).toEqual([]);
    expect(snapshot(ledger, id)).toEqual({ product_price: 242_250, shopee_rate_bps: 400, seller_rate_bps: 1000, estimated_commission: 33_915, estimate_source: "third_party", product_name: "Ao khoac gio nam" });
    expect(ledger.sqlite.prepare("SELECT product_offer_id, shop_id, price, rates_source FROM product_offers").all()).toEqual([{ product_offer_id: ITEM, shop_id: "11001", price: 242_250, rates_source: "third_party" }]);
    const reply = linkReplyData({ network: "shopee", productName: "x", productImageUrl: null, productPrice: 242_250, shopeeRateBps: 400, sellerRateBps: 1000 }, { guest: false, withheld: true });
    expect(reply.estimate?.cashback).toBe(shopeeEstimate({ price: 242_250, shopeeRateBps: 400, sellerRateBps: 1000, withheld: true }).cashback);
  });

  it("money golden: the 40,000 cap bites on Shopee's part only, XTRA uncapped (2,229,000 at 2.5% + 18% is 441,220, live TestCommissionCap)", async () => {
    const ledger = linkLedger(ledgers);
    const bridge = lookupBridge(PAGES);
    const id = await issued(ledger, bridge);
    const answer = body({ price: 2229000, shopeeRatePercent: 2.5, sellerRatePercent: 18, totalRatePercent: 20.5, commission: 441220, cap: 40000, isCapped: true });
    await lookups(ledger, bridge, addlivetagLookup({ apiKey: KEY, get: fakeGet(() => ok(answer)) }));
    expect(snapshot(ledger, id)).toMatchObject({ estimated_commission: 441_220, estimate_source: "third_party" });
  });

  it("an error, a timeout, an empty shell or unusable rates fall back to the bridge, whose rates are marked shopee", async () => {
    const failures: (() => Promise<HttpAnswer> | HttpAnswer)[] = [
      () => ({ status: 500, json: async () => ({}) }),
      () => Promise.reject(new TypeError("fetch failed")),
      () => new Promise<HttpAnswer>(() => undefined),
      () => ok({ status: "success", productInfo: { itemId: "", productName: "" } }),
      () => ok(body({ shopeeRatePercent: 0, sellerRatePercent: 0, totalRatePercent: 0, isXtra: false })),
    ];
    for (const failure of failures) {
      const ledger = linkLedger(ledgers);
      const bridge = lookupBridge(PAGES);
      const id = await issued(ledger, bridge);
      await lookups(ledger, bridge, addlivetagLookup({ apiKey: KEY, get: fakeGet(failure), timeoutMs: 20 }));
      expect(bridge.lookups).toHaveLength(1);
      expect(snapshot(ledger, id)).toMatchObject({ shopee_rate_bps: 550, seller_rate_bps: 300, estimate_source: "shopee" });
    }
  });

  it("without a third party (THIRD_PARTY_LOOKUP off) only the bridge is asked; a short link with no item id skips the third party", async () => {
    const ledger = linkLedger(ledgers);
    const bridge = lookupBridge(PAGES);
    await issued(ledger, bridge);
    await lookups(ledger, bridge, null);
    expect(bridge.lookups).toHaveLength(1);
    const get = fakeGet(() => ok(body({})));
    const short = linkLedger(ledgers);
    const shortBridge = lookupBridge({ outcome: "value", value: { found: false } });
    const id = await issued(short, shortBridge);
    short.sqlite.prepare("UPDATE link_requests SET product_key = NULL WHERE request_id = ?").run(id);
    await lookups(short, shortBridge, addlivetagLookup({ apiKey: KEY, get }));
    expect(get.calls).toEqual([]);
    expect(shortBridge.lookups).toHaveLength(1);
  });

  it("the key is never logged, on success or failure", async () => {
    for (const answer of [() => ok(body({})), () => Promise.reject(new TypeError(`fetch failed ${ADDLIVETAG_API_URL}?key=${KEY}`)), () => ({ status: 401, json: async () => ({}) })]) {
      const ledger = linkLedger(ledgers);
      const bridge = lookupBridge(PAGES);
      const { logger, lines } = memoryLogger();
      await issued(ledger, bridge);
      await lookups(ledger, bridge, addlivetagLookup({ apiKey: KEY, get: fakeGet(answer) }), logger);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(line).not.toContain(KEY);
    }
    const { logger, lines } = memoryLogger();
    logger.info({ addlivetagApiKey: KEY, headers: { "X-API-Key": KEY } }, "test.redaction");
    expect(lines.join("")).not.toContain(KEY);
  });
});

describe("config and dev isolation", () => {
  const TOKEN = "t".repeat(40);
  const context = (prodEnv: Record<string, string> | null): IsolationContext => ({ identifiers: productionIdentifiers(REPOSITORY_ROOT, tempDir("cashback-tp-home-")), prodEnv, devFileIsProdFile: false, caseInsensitive: process.platform === "win32" });
  const dev = (values: Record<string, string> = {}) => parseConfig("dev", { INTERNAL_TOKEN: TOKEN, ...values });
  const prod = (values: Record<string, string> = {}) => parseConfig("prod", { INTERNAL_TOKEN: TOKEN, ...values });

  it("on by default in production when the key is set, off in dev unless THIRD_PARTY_LOOKUP=on; on without the key is refused", () => {
    expect(prod({ ADDLIVETAG_API_KEY: KEY }).thirdPartyLookup).toBe(true);
    expect(prod({}).thirdPartyLookup).toBe(false);
    expect(prod({ ADDLIVETAG_API_KEY: KEY, THIRD_PARTY_LOOKUP: "off" }).thirdPartyLookup).toBe(false);
    expect(dev({ ADDLIVETAG_API_KEY: KEY }).thirdPartyLookup).toBe(false);
    expect(dev({ ADDLIVETAG_API_KEY: KEY, THIRD_PARTY_LOOKUP: "on" }).thirdPartyLookup).toBe(true);
    expect(() => dev({ THIRD_PARTY_LOOKUP: "on" })).toThrow(new ConfigError("config: missing or invalid ADDLIVETAG_API_KEY"));
    expect(thirdPartyLookupFor(dev({ ADDLIVETAG_API_KEY: KEY }))).toBeNull();
    expect(thirdPartyLookupFor(prod({ ADDLIVETAG_API_KEY: KEY }))).not.toBeNull();
    expect(environmentModes(prod({ ADDLIVETAG_API_KEY: KEY }))).toMatchObject({ thirdPartyLookup: true });
  });

  it("dev holding the production key is refused unless ALLOW_PROD_ADDLIVETAG_KEY=1, then only warned; the problem names the key, never the value", () => {
    const prodEnv = { ADDLIVETAG_API_KEY: KEY };
    const shared = dev({ ADDLIVETAG_API_KEY: KEY, THIRD_PARTY_LOOKUP: "on" });
    const problems = isolationProblems(shared, context(prodEnv));
    expect(problems.map((p) => `${p.key} ${p.reason}`)).toEqual(["ADDLIVETAG_API_KEY same_as_production"]);
    expect(JSON.stringify(problems)).not.toContain(KEY);
    const allowed = dev({ ADDLIVETAG_API_KEY: KEY, ALLOW_PROD_ADDLIVETAG_KEY: "1" });
    expect(isolationProblems(allowed, context(prodEnv))).toEqual([]);
    expect(isolationWarnings(allowed, context(prodEnv))).toEqual(["ADDLIVETAG_API_KEY shared_with_production"]);
    expect(isolationProblems(dev({ ADDLIVETAG_API_KEY: "a-dev-key-of-its-own-000000" }), context(prodEnv))).toEqual([]);
  });
});

describe("cutover carry-over of ADDLIVETAG_API_KEY", () => {
  it("is copied from the live .env into an unset prod.env key, by name only, and counts as a carried, checked secret", () => {
    const plan = planCarryOver(`ADDLIVETAG_API_KEY=${KEY}\n`, "INTERNAL_TOKEN=x\n");
    expect(plan.carried).toEqual(["ADDLIVETAG_API_KEY"]);
    expect(plan.text).toContain(`ADDLIVETAG_API_KEY=${KEY}`);
    expect(planCarryOver(`ADDLIVETAG_API_KEY=${KEY}\n`, "ADDLIVETAG_API_KEY=own\n").kept).toEqual(["ADDLIVETAG_API_KEY"]);
    expect(CARRIED_SECRET_KEYS).toContain("ADDLIVETAG_API_KEY");
    expect(SECRET_KEYS).toContain("ADDLIVETAG_API_KEY");
    const dir = tempDir("cashback-tp-carry-");
    const live = join(dir, "live.env");
    const prodFile = join(dir, "prod.env");
    writeFileSync(live, `ADDLIVETAG_API_KEY=${KEY}\n`);
    writeFileSync(prodFile, "INTERNAL_TOKEN=x\n");
    expect(JSON.stringify(carryOverStep(live, prodFile, {}, false).line)).not.toContain(KEY);
  });

  it("the key committed on main is kept only when the owner accepts it (--accept-gaps ADDLIVETAG_API_KEY)", () => {
    const facts = { gaps: [], committed: ["ADDLIVETAG_API_KEY"], shared: ["ADDLIVETAG_API_KEY"], carried: ["ADDLIVETAG_API_KEY"], carriedCommitted: ["ADDLIVETAG_API_KEY"], acceptedGaps: [], missingBuilds: [] };
    expect(preflightVerdict(facts).problems).toEqual(["secrets_committed:ADDLIVETAG_API_KEY", "secrets_committed:ADDLIVETAG_API_KEY"]);
    const kept = preflightVerdict({ ...facts, acceptedGaps: ["ADDLIVETAG_API_KEY"] });
    expect(kept.ok).toBe(true);
    expect(kept.openGaps).toContain("ADDLIVETAG_API_KEY:committed_kept");
  });
});
