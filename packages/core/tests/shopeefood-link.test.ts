/**
 * Story 5.11 (D60): the one reading of a pasted ShopeeFood link, shared by the server and the
 * bridge extension. A shop link or an invite token names the shop without any network call; a
 * short link is left to the real browser.
 */
import { describe, expect, it } from "vitest";

import { hostOnDomain, isShopeeFoodLink, readShopeeFoodLink, readShopeeProduct, SHOPEE_LINK_DOMAINS, SHOPEE_SHORT_LINK_DOMAINS, shopeeFoodKey } from "../src/index";

const b64 = (text: string, url = false): string => {
  const plain = btoa(text);
  return url ? plain.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : plain;
};

describe("Story 5.11: ShopeeFood links", () => {
  it("AC2: a shop link on any ShopeeFood host becomes the canonical shop URL and the shop key", () => {
    for (const link of ["https://shopeefood.vn/now-food/shop/1234567", "https://food.shopee.vn/now-food/shop/1234567?ref=x", "http://shopee.vn/now-food/shop/1234567/menu", "https://www.shopeefood.vn/now-food/shop/1234567#top"]) {
      expect(readShopeeFoodLink(link)).toEqual({ ok: true, sourceUrl: "https://shopeefood.vn/now-food/shop/1234567", shopId: "1234567", resolve: false });
    }
    expect(shopeeFoodKey("1234567")).toBe("shopeefood:1234567");
  });

  it("AC2: a group-order invite names its shop by the token's shopId, base64 or base64url, number or text", () => {
    for (const token of [b64('{"shopId":1234567}'), b64('{"shopId":"1234567","n":"à?"}', true)]) {
      expect(readShopeeFoodLink(`https://shopeefood.vn/group-order/invite?token=${encodeURIComponent(token)}`)).toMatchObject({ ok: true, shopId: "1234567", sourceUrl: "https://shopeefood.vn/now-food/shop/1234567" });
    }
    const unreadable = `https://shopeefood.vn/group-order/invite?token=${b64('{"shop":1}')}`;
    expect(readShopeeFoodLink(unreadable)).toEqual({ ok: true, sourceUrl: unreadable, shopId: null, resolve: true });
    expect(readShopeeFoodLink("https://shopeefood.vn/group-order/invite?token=%%%")).toMatchObject({ ok: true, shopId: null, resolve: true });
  });

  it("AC2: a /u/ or /share/ short link is kept as pasted for the browser to resolve; a dish page is kept without its query and has no key", () => {
    expect(readShopeeFoodLink("https://shopeefood.vn/u/u1vZZ8Q")).toEqual({ ok: true, sourceUrl: "https://shopeefood.vn/u/u1vZZ8Q", shopId: null, resolve: true });
    expect(readShopeeFoodLink("https://shopeefood.vn/share/abc?x=1")).toMatchObject({ resolve: true, shopId: null });
    expect(readShopeeFoodLink("https://shopeefood.vn/ho-chi-minh/tra-sua-gong-cha?utm=1")).toEqual({ ok: true, sourceUrl: "https://shopeefood.vn/ho-chi-minh/tra-sua-gong-cha", shopId: null, resolve: false });
  });

  it("refuses anything that is not ShopeeFood, and Shopee products stay Shopee products", () => {
    for (const link of ["https://shopee.vn/Ao-i.1.2", "https://notshopeefood.vn/now-food/shop/1", "https://shopeefood.vn.evil.com/now-food/shop/1", "ftp://shopeefood.vn/now-food/shop/1", "https://u:p@shopeefood.vn/now-food/shop/1", "not a link"]) {
      expect(isShopeeFoodLink(link)).toBe(false);
      expect(readShopeeFoodLink(link)).toEqual({ ok: false, reason: "not_shopeefood" });
    }
    expect(readShopeeFoodLink(`https://shopeefood.vn/u/${"a".repeat(3000)}`)).toEqual({ ok: false, reason: "too_long" });
    expect(readShopeeProduct("https://shopeefood.vn/now-food/shop/1234567")).toEqual({ ok: false, reason: "not_shopee" });
  });

  it("ShopeeFood's domain and the ShopeeFood short-link host are on the Shopee lists (D60)", () => {
    expect(hostOnDomain("shopeefood.vn", SHOPEE_LINK_DOMAINS)).toBe(true);
    expect(hostOnDomain("spf.shopee.vn", SHOPEE_SHORT_LINK_DOMAINS)).toBe(true);
  });
});
