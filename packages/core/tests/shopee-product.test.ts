import { describe, expect, it } from "vitest";

import { readShopeeProduct, SHOPEE_SOURCE_MAX_LENGTH, shopeeProductKeyOf } from "../src/text/shopee-product";

describe("readShopeeProduct (Stories 5.2 and 5.3 review)", () => {
  it("keeps a product link as its short canonical URL, however long its name, with the product key", () => {
    const long = `https://shopee.vn/${"%E1%BA%A5o-".repeat(400)}-i.166586877.10096389022?sp_atk=x`;
    expect(long.length).toBeGreaterThan(SHOPEE_SOURCE_MAX_LENGTH);
    expect(readShopeeProduct(long)).toEqual({ ok: true, sourceUrl: "https://shopee.vn/product/166586877/10096389022", productKey: "shopee:166586877.10096389022" });
  });

  it("gives a search, the home page, a shop page, a flash sale and a short link no product key", () => {
    for (const url of ["https://shopee.vn/search?keyword=a", "https://shopee.vn/", "https://shopee.vn/shop/166586877", "https://shopee.vn/flash_sale?promotionId=1", "https://s.shopee.vn/AbC123"]) {
      expect(readShopeeProduct(url)).toEqual({ ok: true, sourceUrl: new URL(url).href, productKey: null });
    }
  });

  it("refuses a non-Shopee link, ShopeeFood, credentials, and a non-product link too long for a bridge job", () => {
    for (const url of ["https://lazada.vn/x", "https://food.shopee.vn/x-i.1.2", "https://u:p@shopee.vn/x-i.1.2", "javascript:alert(1)", ""]) expect(readShopeeProduct(url)).toEqual({ ok: false, reason: "not_shopee" });
    expect(readShopeeProduct(`https://shopee.vn/search?keyword=${"a".repeat(2100)}`)).toEqual({ ok: false, reason: "too_long" });
  });

  it("keys stored text by the link inside a pasted message, and nothing else", () => {
    expect(shopeeProductKeyOf("xem giup https://shopee.vn/x-i.1.2 nhe")).toBe("shopee:1.2");
    expect(shopeeProductKeyOf("xem giup https://shopee.vn/search?keyword=a nhe")).toBeNull();
    expect(shopeeProductKeyOf("no link here")).toBeNull();
    expect(shopeeProductKeyOf(null)).toBeNull();
  });
});
