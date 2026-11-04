/**
 * fix(linking) 2026-11-04: a Shopee product short link learns its product key from the target the
 * browser resolved it to, so the lookup can ask the third party and the reply waits for the price.
 * The bridge is a fake; nothing reaches a browser or Shopee.
 */
import { afterEach, describe, expect, it } from "vitest";

import { productKeyFromTarget } from "../src/modules/linking/domain/link-check";
import { linkReplyFactsOf } from "../src/modules/linking/link-reply.query";
import type { Ledger } from "../src/platform/db/ledger";
import type { BridgeLinkResult } from "../src/platform/ports/bridge.port";
import { answeringBridge, C1, linkLedger, linkRow, queueLink, runLinks } from "./helpers/link-ledger";

const ledgers: Ledger[] = [];
afterEach(() => {
  for (const l of ledgers.splice(0)) l.close();
});

const SHORT = "https://vn.shp.ee/SHq2FShF";
const PRODUCT = "https://shopee.vn/product/1524779718/47256657613";

const shopeeBridge = (sourceTarget?: string) =>
  answeringBridge((job): BridgeLinkResult => ({
    outcome: "link",
    url: "https://s.shopee.vn/AKbrmzxJCt",
    resolvedUrl: `${PRODUCT}?utm_content=${job.subId1}-${job.subId2}---`,
    ...(sourceTarget === undefined ? {} : { sourceTarget }),
  }));

describe("fix(linking): a product short link learns its product key from the browser", () => {
  it("the resolved product becomes the request's key, and the reply waits for the lookup", async () => {
    const ledger = linkLedger(ledgers);
    const id = queueLink(ledger, C1, SHORT);
    expect(linkRow(ledger, id)).toMatchObject({ product_key: null, platform: "shopee" });
    await runLinks(ledger, shopeeBridge(PRODUCT));
    expect(linkRow(ledger, id)).toMatchObject({ status: "ISSUED", product_key: "shopee:1524779718.47256657613" });
    expect(ledger.tx((db) => linkReplyFactsOf(db, id))?.factsSettled).toBe(false);
  });

  it("a key the request already has is never replaced, and a target naming no product sets none", async () => {
    const keyed = linkLedger(ledgers);
    const id = queueLink(keyed, C1, PRODUCT);
    await runLinks(keyed, shopeeBridge("https://shopee.vn/product/1/99999999"));
    expect(linkRow(keyed, id).product_key).toBe("shopee:1524779718.47256657613");
    const plain = linkLedger(ledgers);
    const short = queueLink(plain, C1, SHORT);
    await runLinks(plain, shopeeBridge("https://shopee.vn/search?keyword=x"));
    expect(linkRow(plain, short)).toMatchObject({ status: "ISSUED", product_key: null });
  });

  it("only a short source and an https product target count", () => {
    expect(productKeyFromTarget(SHORT, `${PRODUCT}?x=1`)).toEqual({ kind: "key", productKey: "shopee:1524779718.47256657613" });
    expect(productKeyFromTarget(SHORT, null)).toEqual({ kind: "none" });
    expect(productKeyFromTarget("https://shopee.vn/search?keyword=x", PRODUCT)).toEqual({ kind: "ignored" });
    expect(productKeyFromTarget(SHORT, "http://shopee.vn/product/1524779718/47256657613")).toEqual({ kind: "ignored" });
    expect(productKeyFromTarget(SHORT, "https://evil.example/product/1524779718/47256657613")).toEqual({ kind: "ignored" });
  });
});
