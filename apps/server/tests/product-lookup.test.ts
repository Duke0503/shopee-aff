/**
 * Story 5.6: a product lookup through the browser bridge reads page 1 only, stores the product
 * snapshot (D56), and the reply data carries the estimated cashback from packages/money with an
 * example amount beside every percentage, or a dash when no rate was found. The bridge is a fake
 * (or the real adapter's queue with a hand-run timer); nothing here reaches a browser or Shopee.
 */
import { bridgeLookupValueSchema, type BridgeLookupValue } from "@cashback/contracts";
import { fixedClock, searchText } from "@cashback/core";
import { shopeeEstimate } from "@cashback/money";
import { afterEach, describe, expect, it } from "vitest";

import { linkEffectsFor } from "../src/links/link-jobs";
import { browserBridge, claimLookupJob, fakeBridge, labelledRate, linkReplyData, LOOKUP_RETRY_MS, LOOKUP_WINDOW_MS, PRODUCT_FACTS_FRESH_MS, readPriceText, readRateText, runProductLookups, splitRates, type BridgeTimer } from "../src/modules/linking/index";
import type { Ledger } from "../src/platform/db/ledger";
import type { BridgeLookupResult, BridgePort, LookupBridgeJob } from "../src/platform/ports/bridge.port";
import { queueLinkRequest } from "../src/modules/linking/index";
import { alertRows, C1, LINK_START, linkLedger, movingClock, queueLink, runLinks, SILENT } from "./helpers/link-ledger";

const ledgers: Ledger[] = [];
afterEach(() => {
  for (const l of ledgers.splice(0)) l.close();
});

const PRODUCT = "https://shopee.vn/Noi-com-dien-i.11001.22001";
const RICE_COOKER: BridgeLookupValue = { found: true, shopId: "11001", itemId: "22001", name: "N\u1ed3i c\u01a1m \u0111i\u1ec7n 1.8L", imageUrl: "https://down-vn.img.susercontent.com/file/abc", priceText: "\u20ab450.000", rates: { commissionTexts: ["Hoa h\u1ed3ng 2,6%"], xtraTexts: [] } };

interface Snapshot {
  product_offer_id: string | null;
  product_name: string | null;
  product_image_url: string | null;
  product_price: number | null;
  shopee_rate_bps: number | null;
  seller_rate_bps: number | null;
  estimated_commission: number | null;
  search_text: string;
}
const snapshotOf = (ledger: Ledger, id: string) =>
  ledger.sqlite.prepare("SELECT product_offer_id, product_name, product_image_url, product_price, shopee_rate_bps, seller_rate_bps, estimated_commission, search_text FROM link_requests WHERE request_id = ?").get(id) as Snapshot;
const lookupJobs = (ledger: Ledger) => ledger.sqlite.prepare("SELECT request_id, status, failure, source_url, customer_id, sub_id1, sub_id2 FROM bridge_jobs WHERE kind = 'LOOKUP' ORDER BY job_id").all() as { request_id: string; status: string; failure: string | null; source_url: string; customer_id: string | null; sub_id1: string | null; sub_id2: string | null }[];

/** A fake bridge whose lookups answer `answer` and are recorded. */
function lookupBridge(answer: (job: LookupBridgeJob) => BridgeLookupResult): BridgePort & { lookups: LookupBridgeJob[] } {
  const fake = fakeBridge();
  const lookups: LookupBridgeJob[] = [];
  return { mode: "fake", lookups, createLink: fake.createLink, lookupProduct: async (job) => (lookups.push(job), answer(job)) };
}

const lookups = (ledger: Ledger, bridge: BridgePort, clock = fixedClock(LINK_START)) => runProductLookups({ ledger, clock, bridge, logger: SILENT, effects: linkEffectsFor(clock) }, new AbortController().signal);

/** An issued request with its lookup done by `bridge`. */
async function issuedAndLookedUp(ledger: Ledger, bridge: BridgePort, url = PRODUCT): Promise<string> {
  const id = queueLink(ledger, C1, url);
  await runLinks(ledger, bridge);
  await lookups(ledger, bridge);
  return id;
}

const NO_TIMERS: BridgeTimer = { schedule: () => null, cancel: () => undefined };

describe("Story 5.6 AC1: a lookup reads page 1 only", () => {
  it("AC1: the lookup job the bridge hands the browser carries the product link and no page parameter", async () => {
    const bridge = browserBridge({ timer: NO_TIMERS, makeTicket: () => "b".repeat(32) });
    const answer = bridge.lookupProduct?.({ jobId: 1, requestId: "R1", url: "https://shopee.vn/product/11001/22001" }, new AbortController().signal);
    const job = await bridge.work.next("c".repeat(32), new AbortController().signal);
    expect(Object.keys(job ?? {}).sort()).toEqual(["kind", "ticket", "timeoutMs", "url"]);
    expect(job).toMatchObject({ kind: "lookup", url: "https://shopee.vn/product/11001/22001" });
    expect(bridge.work.deliver({ ticket: "b".repeat(32), outcome: "value", value: RICE_COOKER }, "c".repeat(32))).toBe(true);
    expect(await answer).toEqual({ outcome: "value", value: RICE_COOKER });
  });

  it("AC1: a lookup job holds one request's product link only: no customer and no sub_ids", async () => {
    const ledger = linkLedger(ledgers);
    const bridge = lookupBridge(() => ({ outcome: "value", value: RICE_COOKER }));
    const id = await issuedAndLookedUp(ledger, bridge);
    expect(bridge.lookups).toEqual([{ jobId: expect.any(Number), requestId: id, url: "https://shopee.vn/product/11001/22001" }]);
    expect(lookupJobs(ledger)).toEqual([{ request_id: id, status: "DONE", failure: null, source_url: "https://shopee.vn/product/11001/22001", customer_id: null, sub_id1: null, sub_id2: null }]);
  });
});

describe("Story 5.6 AC2: the estimate comes from packages/money and is flagged", () => {
  it("AC2: a 450,000 dong product at 2.6% gives the UJ-1 estimate from packages/money, flagged as an estimate (golden: shopee-estimate.json)", async () => {
    const ledger = linkLedger(ledgers);
    const id = await issuedAndLookedUp(ledger, lookupBridge(() => ({ outcome: "value", value: RICE_COOKER })));
    const s = snapshotOf(ledger, id);
    expect(s).toEqual({ product_offer_id: "22001", product_name: RICE_COOKER.found ? RICE_COOKER.name : null, product_image_url: "https://down-vn.img.susercontent.com/file/abc", product_price: 450_000, shopee_rate_bps: 260, seller_rate_bps: 0, estimated_commission: 11_700, search_text: searchText(s.product_name) });
    const facts = { network: "shopee" as const, productName: s.product_name, productImageUrl: s.product_image_url, productPrice: s.product_price, shopeeRateBps: s.shopee_rate_bps, sellerRateBps: s.seller_rate_bps };
    const notWithheld = linkReplyData(facts, { guest: false, withheld: false });
    expect(notWithheld.estimate).toMatchObject({ estimate: true, cashback: 9_268, commission: 11_700, withheld: false, capped: false });
    expect(notWithheld.estimate?.cashback).toBe(shopeeEstimate({ price: 450_000, shopeeRateBps: 260, sellerRateBps: 0, withheld: false }).cashback);
    expect(linkReplyData(facts, { guest: false, withheld: true }).estimate).toMatchObject({ estimate: true, cashback: 8_332, withheld: true });
  });

  it("AC2: the shared product facts are saved once per item and a second customer's request within 6 hours takes them without a bridge job", async () => {
    const ledger = linkLedger(ledgers);
    const bridge = lookupBridge(() => ({ outcome: "value", value: RICE_COOKER }));
    await issuedAndLookedUp(ledger, bridge);
    const other = queueLink(ledger, "1000000000000000002", PRODUCT);
    await runLinks(ledger, bridge);
    await lookups(ledger, bridge);
    expect(bridge.lookups).toHaveLength(1);
    expect(snapshotOf(ledger, other)).toMatchObject({ product_offer_id: "22001", product_price: 450_000, shopee_rate_bps: 260 });
    expect(ledger.sqlite.prepare("SELECT product_offer_id, shop_id, price, origin FROM product_offers").all()).toEqual([{ product_offer_id: "22001", shop_id: "11001", price: 450_000, origin: "LOOKUP" }]);
  });
});

describe("Story 5.6 AC3: every percentage in the reply data has an example amount", () => {
  it("AC3: Shopee's rate, the XTRA rate and the 80% share each come with their amount in dong, and the cap is flagged", () => {
    const reply = linkReplyData({ network: "shopee", productName: "x", productImageUrl: null, productPrice: 2_000_000, shopeeRateBps: 300, sellerRateBps: 150 }, { guest: false, withheld: true });
    expect(reply.estimate?.rates).toEqual([
      { part: "shopee", rateBps: 300, amount: 40_000 },
      { part: "seller", rateBps: 150, amount: 30_000 },
      { part: "customer_share", rateBps: 8_000, amount: 49_851 },
    ]);
    expect(reply.estimate).toMatchObject({ capped: true, cashback: 49_851, commission: 70_000 });
    for (const rate of reply.estimate?.rates ?? []) expect(Number.isSafeInteger(rate.amount)).toBe(true);
  });
});

describe("Story 5.6 AC4: no rate means no estimate, never 0", () => {
  it("AC4: a product not on page 1 keeps its name and price but its reply has no estimate (a dash)", async () => {
    const ledger = linkLedger(ledgers);
    const value: BridgeLookupValue = { ...RICE_COOKER, rates: null } as BridgeLookupValue;
    const id = await issuedAndLookedUp(ledger, lookupBridge(() => ({ outcome: "value", value })));
    const s = snapshotOf(ledger, id);
    expect(s).toMatchObject({ product_price: 450_000, shopee_rate_bps: null, seller_rate_bps: null, estimated_commission: null });
    const reply = linkReplyData({ network: "shopee", productName: s.product_name, productImageUrl: null, productPrice: s.product_price, shopeeRateBps: null, sellerRateBps: null }, { guest: false, withheld: false });
    expect(reply.estimate).toBeNull();
    expect(reply.product.price).toBe(450_000);
  });

  it("AC4: an unreadable rate or price text gives null, never 0; a guest gets no estimate at all", () => {
    expect([readRateText("2,6%"), readRateText("7.5 %"), readRateText("10%"), readRateText("Up to 10%"), readRateText(""), readRateText("2.655%")]).toEqual([260, 750, 1000, null, null, null]);
    expect([readPriceText("\u20ab450.000"), readPriceText("450,000\u20ab"), readPriceText("450000"), readPriceText("\u20ab100.000 - \u20ab200.000"), readPriceText("0")]).toEqual([450_000, 450_000, 450_000, null, null]);
    expect(splitRates(["Hoa h\u1ed3ng 7,5%"], ["XTRA 3%"])).toEqual({ shopeeRateBps: 450, sellerRateBps: 300 });
    expect(splitRates(["Commission 3%"], ["XTRA 7,5%"])).toEqual({ shopeeRateBps: null, sellerRateBps: null });
    expect(linkReplyData({ network: "shopee", productName: "x", productImageUrl: null, productPrice: 450_000, shopeeRateBps: 260, sellerRateBps: 0 }, { guest: true, withheld: false })).toMatchObject({ guest: true, estimate: null });
  });

  it("AC4 (review item 7): a lookup that finds no rate is tried once more after the retry delay, never a third time, and stores no made-up snapshot", async () => {
    for (const answer of [{ outcome: "value", value: { found: false } }, { outcome: "failed", reason: "page_not_ready" }, { outcome: "value", value: { found: true, price: 1 } }] as BridgeLookupResult[]) {
      const ledger = linkLedger(ledgers);
      const bridge = lookupBridge(() => answer);
      const clock = movingClock();
      const id = await issuedAndLookedUp(ledger, bridge);
      await lookups(ledger, bridge, clock);
      expect(bridge.lookups).toHaveLength(1);
      clock.advance(LOOKUP_RETRY_MS);
      await lookups(ledger, bridge, clock);
      expect(bridge.lookups).toHaveLength(2);
      clock.advance(LOOKUP_RETRY_MS);
      await lookups(ledger, bridge, clock);
      expect(bridge.lookups).toHaveLength(2);
      expect(snapshotOf(ledger, id)).toMatchObject({ product_offer_id: null, product_name: null, estimated_commission: null });
    }
    expect(bridgeLookupValueSchema.safeParse({ found: true, price: 1 }).success).toBe(false);
  });

  it("review item 7: the second lookup keeps what the first read and adds the rates it finds", async () => {
    const ledger = linkLedger(ledgers);
    const answers: BridgeLookupValue[] = [{ ...RICE_COOKER, rates: null } as BridgeLookupValue, { ...RICE_COOKER, name: null, priceText: null } as BridgeLookupValue];
    const bridge = lookupBridge(() => ({ outcome: "value", value: answers.shift() ?? { found: false } }));
    const clock = movingClock();
    const id = await issuedAndLookedUp(ledger, bridge);
    clock.advance(LOOKUP_RETRY_MS);
    await lookups(ledger, bridge, clock);
    expect(snapshotOf(ledger, id)).toMatchObject({ product_name: RICE_COOKER.found ? RICE_COOKER.name : null, product_price: 450_000, shopee_rate_bps: 260, seller_rate_bps: 0, estimated_commission: 11_700 });
  });
});

describe("Story 5.6 review items 1-4: an unreadable page gives no estimate, never a wrong one", () => {
  const offerRow = (ledger: Ledger) => ledger.sqlite.prepare("SELECT name, price, shopee_rate_bps, seller_rate_bps, updated_at FROM product_offers WHERE product_offer_id = '22001'").get();

  it("item 1: a later lookup that lacks the price or the rates keeps the known shared facts and does not count as a refresh", async () => {
    const ledger = linkLedger(ledgers);
    const answers: BridgeLookupValue[] = [RICE_COOKER, { ...RICE_COOKER, priceText: null, rates: null } as BridgeLookupValue];
    const bridge = lookupBridge(() => ({ outcome: "value", value: answers.shift() ?? { found: false } }));
    await issuedAndLookedUp(ledger, bridge);
    expect(offerRow(ledger)).toEqual({ name: RICE_COOKER.found ? RICE_COOKER.name : null, price: 450_000, shopee_rate_bps: 260, seller_rate_bps: 0, updated_at: LINK_START });
    const later = movingClock();
    later.advance(PRODUCT_FACTS_FRESH_MS + 1);
    const other = ledger.tx((db) => queueLinkRequest(db, { customer: "1000000000000000002", url: PRODUCT, channel: "zalo" }, later)).requestId;
    await runLinks(ledger, bridge, { clock: later });
    await lookups(ledger, bridge, later);
    expect(bridge.lookups).toHaveLength(2);
    expect(offerRow(ledger)).toEqual({ name: RICE_COOKER.found ? RICE_COOKER.name : null, price: 450_000, shopee_rate_bps: 260, seller_rate_bps: 0, updated_at: LINK_START });
    expect(snapshotOf(ledger, other)).toMatchObject({ shopee_rate_bps: null, estimated_commission: null });
  });

  it("item 1: shared facts without rates are never taken as fresh: the next request still gets a lookup", async () => {
    const ledger = linkLedger(ledgers);
    const bridge = lookupBridge(() => ({ outcome: "value", value: { ...RICE_COOKER, rates: null } as BridgeLookupValue }));
    await issuedAndLookedUp(ledger, bridge);
    queueLink(ledger, "1000000000000000002", PRODUCT);
    await runLinks(ledger, bridge);
    await lookups(ledger, bridge);
    expect(bridge.lookups).toHaveLength(2);
    expect(offerRow(ledger)).toMatchObject({ price: 450_000, shopee_rate_bps: null, updated_at: null });
  });

  it("item 2: a price range or a from-price as the page shows it gives no price, so no estimate", async () => {
    for (const priceText of ["\u20ab100.000 - \u20ab200.000", "T\u1eeb \u20ab450.000", "\u20ab450.000 \u20ab399.000"]) {
      expect(readPriceText(priceText)).toBeNull();
      const ledger = linkLedger(ledgers);
      const id = await issuedAndLookedUp(ledger, lookupBridge(() => ({ outcome: "value", value: { ...RICE_COOKER, priceText } as BridgeLookupValue })));
      expect(snapshotOf(ledger, id)).toMatchObject({ product_price: null, estimated_commission: null });
    }
  });

  it("item 3: the commission comes only from labelled texts that agree on one percentage; a discount badge is ignored and anything ambiguous gives no rate", () => {
    expect(labelledRate(["Hoa h\u1ed3ng 7,5%"])).toBe(750);
    expect(labelledRate(["Hoa h\u1ed3ng 7,5%", "Commission 7.5%"])).toBe(750);
    expect(labelledRate(["Hoa h\u1ed3ng 7,5%", "Hoa h\u1ed3ng 10%"])).toBeNull();
    expect(labelledRate(["Hoa h\u1ed3ng 7,5% XTRA 3%"])).toBeNull();
    expect(labelledRate(["Hoa h\u1ed3ng"])).toBeNull();
    expect(labelledRate(["Hoa h\u1ed3ng 7,555%"])).toBeNull();
    expect(labelledRate([])).toBe("absent");
    expect(splitRates([], [])).toEqual({ shopeeRateBps: null, sellerRateBps: null });
  });

  it("item 4: a card that shows XTRA whose percentage cannot be read gives no estimate, not an XTRA of 0%", async () => {
    expect(splitRates(["Hoa h\u1ed3ng 7,5%"], ["XTRA"])).toEqual({ shopeeRateBps: null, sellerRateBps: null });
    expect(splitRates(["Hoa h\u1ed3ng 7,5%"], ["XTRA 2%", "XTRA 3%"])).toEqual({ shopeeRateBps: null, sellerRateBps: null });
    expect(splitRates(["Hoa h\u1ed3ng 7,5%"], [])).toEqual({ shopeeRateBps: 750, sellerRateBps: 0 });
    const ledger = linkLedger(ledgers);
    const id = await issuedAndLookedUp(ledger, lookupBridge(() => ({ outcome: "value", value: { ...RICE_COOKER, rates: { commissionTexts: ["Hoa h\u1ed3ng 7,5%"], xtraTexts: ["XTRA"] } } as BridgeLookupValue })));
    expect(snapshotOf(ledger, id)).toMatchObject({ shopee_rate_bps: null, seller_rate_bps: null, estimated_commission: null });
  });
});

describe("Story 5.6: lookups keep the order of service and the session's safety", () => {
  it("a lookup waits while a link submission is due, and the link job serves links first", async () => {
    const ledger = linkLedger(ledgers);
    const bridge = lookupBridge(() => ({ outcome: "value", value: RICE_COOKER }));
    queueLink(ledger, C1, PRODUCT);
    await runLinks(ledger, bridge);
    queueLink(ledger, "1000000000000000002", "https://shopee.vn/Ao-i.11001.33001");
    expect(await lookups(ledger, bridge)).toBe(0);
    expect(bridge.lookups).toEqual([]);
  });

  it("a captcha on a lookup holds the Shopee queue and alerts the owner; a held queue hands out no lookup", async () => {
    const ledger = linkLedger(ledgers);
    const bridge = lookupBridge(() => ({ outcome: "failed", reason: "captcha" }));
    await issuedAndLookedUp(ledger, bridge);
    expect(alertRows(ledger)).toEqual([{ kind: "bridge_captcha", severity: "high", suppressed: 0 }]);
    queueLink(ledger, "1000000000000000002", "https://shopee.vn/Ao-i.11001.33001");
    expect(ledger.tx((db) => claimLookupJob(db, fixedClock(LINK_START)))).toBeNull();
  });

  it("a request older than the lookup window is not looked up: its reply went out without one", async () => {
    const ledger = linkLedger(ledgers);
    const bridge = lookupBridge(() => ({ outcome: "value", value: RICE_COOKER }));
    queueLink(ledger, C1, PRODUCT);
    await runLinks(ledger, bridge);
    const later = movingClock();
    later.advance(LOOKUP_WINDOW_MS + 1);
    expect(await lookups(ledger, bridge, later)).toBe(0);
    expect(bridge.lookups).toEqual([]);
  });

  it("a bridge that does not answer leaves the lookup open; one that went silent twice gives it up", async () => {
    const ledger = linkLedger(ledgers);
    const silent = lookupBridge(() => ({ outcome: "unavailable", reason: "no_answer" }));
    await issuedAndLookedUp(ledger, silent);
    expect(lookupJobs(ledger).map((j) => j.status)).toEqual(["PENDING"]);
    await lookups(ledger, silent);
    expect(lookupJobs(ledger).map((j) => [j.status, j.failure])).toEqual([["FAILED", "bridge_no_answer"]]);
  });
});
