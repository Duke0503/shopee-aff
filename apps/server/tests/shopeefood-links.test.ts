/**
 * Story 5.11 (D60): a ShopeeFood shop or dish link is a Shopee-network link. It goes through the
 * same bridge link job and returned-link checks as a Shopee product; a short link is resolved in
 * the real browser, which tells the server the shop for reuse (`shopeefood:<shopId>`); the reply
 * carries no amount; its orders reconcile under the Shopee money rules. The bridge is a fake;
 * nothing reaches a browser or Shopee.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fixedClock, parseInstant } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";

import { linkReplyData, queueLinkRequest, shopKeyFromTarget, readProductLink, readShopeeConversion, sourced, SHOPEEFOOD_REPLY_KEY } from "../src/modules/linking/index";
import { REPOSITORY_ROOT } from "../src/platform/config/env.config";
import type { Ledger } from "../src/platform/db/ledger";
import type { BridgeLinkResult } from "../src/platform/ports/bridge.port";
import { answeringBridge, C1, C2, LINK_START, linkLedger, linkRow, memoryLogger, queueLink, runLinks } from "./helpers/link-ledger";
import { apply, closeLedgers, freshLedger } from "./helpers/order-ledger";

const ledgers: Ledger[] = [];
afterEach(() => {
  for (const l of ledgers.splice(0)) l.close();
  closeLedgers();
});

const SHOP = "https://shopeefood.vn/now-food/shop/1234567";
const SHORT = "https://shopeefood.vn/u/u1vZZ8Q";
const token = (json: string) => Buffer.from(json, "utf8").toString("base64url");
const INVITE = `https://shopeefood.vn/group-order/invite?token=${token('{"shopId":1234567,"hostId":42}')}`;
const labels = (file: string) => JSON.parse(readFileSync(join(REPOSITORY_ROOT, `packages/labels/vi/${file}.json`), "utf8")) as Record<string, string>;
const reused = (ledger: Ledger, customer: string, url: string) => ledger.tx((db) => queueLinkRequest(db, { customer, url, channel: "zalo" }, fixedClock(LINK_START)));

/** A bridge that answers each job's own sub_ids on a ShopeeFood short link, resolved to `target`, from the shop `sourceTarget`. */
const foodBridge = (sourceTarget?: string, subIds?: (job: { subId1: string; subId2: string }) => string) =>
  answeringBridge((job): BridgeLinkResult => ({
    outcome: "link",
    url: "https://spf.shopee.vn/AbC123",
    resolvedUrl: `https://shopeefood.vn/now-food/shop/1234567?utm_source=an_1&utm_content=${subIds?.(job) ?? `${job.subId1}-${job.subId2}`}---`,
    ...(sourceTarget === undefined ? {} : { sourceTarget }),
  }));

describe("Story 5.11 AC1: a ShopeeFood shop link is a bridge link job with the request's sub_ids", () => {
  it("AC1: the bridge job carries the canonical shop link, sub_id1 = customer and sub_id2 = request id, and the link is attached after the checks", async () => {
    const ledger = linkLedger(ledgers);
    const id = queueLink(ledger, C1, "https://shopee.vn/now-food/shop/1234567?ref=chat");
    const bridge = foodBridge();
    expect(await runLinks(ledger, bridge)).toMatchObject({ issued: 1, failed: 0 });
    expect(bridge.jobs).toEqual([{ jobId: expect.any(Number), requestId: id, sourceUrl: SHOP, subId1: C1, subId2: id }]);
    expect(linkRow(ledger, id)).toMatchObject({ status: "ISSUED", affiliate_url: "https://spf.shopee.vn/AbC123", network: "shopee", platform: "shopeefood", product_key: "shopeefood:1234567" });
  });

  it("AC1: a returned link that carries another request's sub_id2 is dropped and counted, never attached", async () => {
    const ledger = linkLedger(ledgers);
    const id = queueLink(ledger, C1, SHOP);
    expect(await runLinks(ledger, foodBridge(undefined, (job) => `${job.subId1}-26110199999`))).toMatchObject({ issued: 0, failed: 1 });
    expect(linkRow(ledger, id)).toMatchObject({ status: "QUEUED", affiliate_url: null, attempts: 1 });
  });
});

describe("Story 5.11 AC2: short links and invites are read in the real browser, reuse is by shop", () => {
  it("AC2: a /u/ short link goes to the bridge as pasted; the shop the browser resolved becomes the reuse key, and the next link to that shop reuses the request", async () => {
    const ledger = linkLedger(ledgers);
    const id = queueLink(ledger, C1, SHORT);
    expect(linkRow(ledger, id)).toMatchObject({ product_key: null, platform: "shopeefood" });
    const bridge = foodBridge(`${SHOP}?share=1`);
    await runLinks(ledger, bridge);
    expect(bridge.jobs.map((j) => j.sourceUrl)).toEqual([SHORT]);
    expect(linkRow(ledger, id)).toMatchObject({ status: "ISSUED", product_key: "shopeefood:1234567" });
    expect(reused(ledger, C1, SHOP)).toMatchObject({ requestId: id, reused: true });
    expect(reused(ledger, C1, INVITE)).toMatchObject({ requestId: id, reused: true });
    expect(reused(ledger, C2, SHOP)).toMatchObject({ reused: false });
  });

  it("AC2: a group-order invite names its shop through its token, read without any call; two links to one shop from one customer are one request", async () => {
    expect(readProductLink(INVITE)).toEqual({ ok: true, network: "shopee", platform: "shopeefood", sourceUrl: SHOP, productKey: "shopeefood:1234567" });
    const ledger = linkLedger(ledgers);
    const first = queueLink(ledger, C1, INVITE);
    await runLinks(ledger, foodBridge());
    expect(reused(ledger, C1, "https://food.shopee.vn/now-food/shop/1234567")).toMatchObject({ requestId: first, reused: true });
  });

  it("AC2: a browser answer cannot replace a key the request has, and a target that names no shop sets none", async () => {
    const keyed = linkLedger(ledgers);
    const id = queueLink(keyed, C1, SHOP);
    await runLinks(keyed, foodBridge("https://shopeefood.vn/now-food/shop/999"));
    expect(linkRow(keyed, id).product_key).toBe("shopeefood:1234567");
    const plain = linkLedger(ledgers);
    const short = queueLink(plain, C1, SHORT);
    await runLinks(plain, foodBridge("https://shopeefood.vn/ho-chi-minh/tra-sua"));
    expect(linkRow(plain, short)).toMatchObject({ status: "ISSUED", product_key: null });
  });
});

describe("Story 5.11 AC3: the reply carries no amount", () => {
  it("AC3: a ShopeeFood reply has no estimate and no price, and uses the per-shop label", () => {
    const reply = linkReplyData({ network: "shopee", platform: "shopeefood", productName: null, productImageUrl: null, productPrice: 120_000, shopeeRateBps: 500, sellerRateBps: 0 }, { guest: false, withheld: false });
    expect(reply).toEqual({ product: { name: null, imageUrl: null, price: null }, guest: false, estimate: null, perShopKey: SHOPEEFOOD_REPLY_KEY });
    expect(linkReplyData({ network: "shopee", platform: "shopee", productName: "x", productImageUrl: null, productPrice: 120_000, shopeeRateBps: 500, sellerRateBps: 0 }, { guest: false, withheld: false }).perShopKey).toBeNull();
    const text = labels("messages")[reply.perShopKey ?? ""] ?? "";
    expect(text).toContain("ShopeeFood");
    expect(text).toMatch(/quán/);
    expect(text).not.toMatch(/\d/);
    expect(labels("pages")["share_shopeefood_per_shop"]).not.toMatch(/\d/);
  });
});

describe("Story 5.11 AC4: the refusal names Shopee, ShopeeFood and TikTok Shop", () => {
  it("AC4: a Lazada link is refused network_unsupported, and its message names the three link sources", () => {
    expect(readProductLink("https://www.lazada.vn/products/x-i123.html")).toEqual({ ok: false, reason: "network_unsupported" });
    const message = labels("errors")["error.link.network_unsupported"] ?? "";
    for (const name of ["Shopee,", "ShopeeFood", "TikTok Shop"]) expect(message).toContain(name);
  });
});

describe("Story 5.11 AC5: a ShopeeFood order in the Shopee report follows the Shopee money rules", () => {
  /** The live provider's shape inside a Shopee conversion: a food order, sub_ids in utm_content (fixture until a real row exists). */
  const conversion = (orderSn: string, requestId: string) => ({
    checkout_id: `CK${orderSn}`,
    purchase_time: 1_761_620_400,
    utm_content: `C1-${requestId}---`,
    orders: [{ order_sn: orderSn, order_status: "COMPLETED", items: [{ item_id: "9001", display_item_status: "Validated", item_commission: 60_000 * 100_000, capped_brand_commission: 5_000 * 100_000, actual_amount: 800_000 * 100_000 }] }],
  });

  it("AC5: the order is attributed by its sub_ids, kept as ShopeeFood on the Shopee network, and its commission and cashback come out exactly as a Shopee product order's", () => {
    const ledger = freshLedger();
    ledger.sqlite.exec("INSERT INTO link_requests (request_id, customer_id, network, platform, status, source_url, origin, product_key) VALUES ('REQF', 'C1', 'shopee', 'shopeefood', 'DELIVERED', 'https://shopeefood.vn/now-food/shop/1234567', 'REQUEST', 'shopeefood:1234567')");
    const at = parseInstant("2026-10-28T03:00:00.000Z");
    for (const [order, request] of [["261028FOOD0001", "REQF"], ["261028PROD0001", "REQ1"]] as const) for (const row of readShopeeConversion(conversion(order, request))) apply(ledger, sourced(row, at));
    const rows = ledger.sqlite.prepare("SELECT order_id, customer_id, network, platform, status, approved_commission, cashback FROM orders ORDER BY order_id").all() as Record<string, unknown>[];
    expect(rows.map((r) => [r["order_id"], r["customer_id"], r["network"], r["platform"], r["status"]])).toEqual([
      ["261028FOOD0001", "C1", "shopee", "shopeefood", "APPROVED"],
      ["261028PROD0001", "C1", "shopee", "shopee", "APPROVED"],
    ]);
    expect(rows[0]?.["approved_commission"]).toBe(65_000);
    expect([rows[0]?.["approved_commission"], rows[0]?.["cashback"]]).toEqual([rows[1]?.["approved_commission"], rows[1]?.["cashback"]]);
  });
});

describe("Story 5.11 review 10: the browser's resolved source is trusted only when it can belong to the request", () => {
  it("review 10: a target off ShopeeFood, or with no shop, sets no key and the job logs it; the link is still attached after its own checks", async () => {
    const ledger = linkLedger(ledgers);
    const id = queueLink(ledger, C1, SHORT);
    const { logger, lines } = memoryLogger();
    await runLinks(ledger, foodBridge("https://shopee.vn/product/11001/22001"), { logger });
    expect(linkRow(ledger, id)).toMatchObject({ status: "ISSUED", product_key: null });
    expect(lines.some((l) => l.includes("linking.link.source_target_ignored") && l.includes(id))).toBe(true);
  });

  it("review 10: an invite's own shop must match the resolved shop; only a source that named no shop learns one", () => {
    const inviteOf = (shopId: number) => `https://shopeefood.vn/group-order/invite?token=${token(`{"shopId":${shopId}}`)}`;
    expect(shopKeyFromTarget(SHORT, SHOP)).toEqual({ kind: "key", productKey: "shopeefood:1234567" });
    expect(shopKeyFromTarget(inviteOf(1234567), "https://shopeefood.vn/now-food/shop/999")).toEqual({ kind: "ignored" });
    expect(shopKeyFromTarget("https://shopeefood.vn/group-order/invite?token=unreadable", SHOP)).toEqual({ kind: "key", productKey: "shopeefood:1234567" });
    expect(shopKeyFromTarget(SHORT, "https://evil.example/now-food/shop/1234567")).toEqual({ kind: "ignored" });
    expect(shopKeyFromTarget(SHORT, null)).toEqual({ kind: "none" });
  });
});
