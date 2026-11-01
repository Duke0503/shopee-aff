// @vitest-environment jsdom
/**
 * Story 5.6: the lookup's page scripts on copies of the storefront and offer search structure
 * (jsdom, no network). Each looks once and returns the texts as shown.
 */
import { describe, expect, it } from "vitest";

import { readOfferResults, readStorefront } from "../src/page-scripts";
import { COMMISSION_LABEL, OFFER_CARD, OFFER_EMPTY, STOREFRONT_IMAGE, STOREFRONT_NAME, STOREFRONT_PRICE, XTRA_LABEL } from "../src/shopee-page";

const STORE = { name: STOREFRONT_NAME, image: STOREFRONT_IMAGE, price: STOREFRONT_PRICE };
const OFFER = { itemId: "22001", card: OFFER_CARD, empty: OFFER_EMPTY, commissionLabel: COMMISSION_LABEL, xtraLabel: XTRA_LABEL };

describe("Story 5.6: storefront and offer search page scripts", () => {
  it("reads the name without the site suffix, an https picture and the price text", () => {
    document.head.innerHTML = '<meta property="og:title" content="Noi com dien 1.8L | Shopee Viet Nam"><meta property="og:image" content="https://down-vn.img.susercontent.com/file/abc">';
    document.body.innerHTML = '<div class="product-price">\u20ab450.000</div>';
    expect(readStorefront(STORE)).toMatchObject({ name: "Noi com dien 1.8L", image: "https://down-vn.img.susercontent.com/file/abc", priceText: "\u20ab450.000", passwordBox: false });
    document.head.innerHTML = '<meta property="og:image" content="http://plain.example/a.jpg">';
    document.body.innerHTML = "<h1>Ten san pham</h1>";
    expect(readStorefront(STORE)).toMatchObject({ name: "Ten san pham", image: null, priceText: null });
  });

  it("finds the item's own card on page 1 and reads its total and XTRA rates, ignoring an item id that only contains it", () => {
    document.body.innerHTML = `
      <div class="product-card"><a href="/offer/product_offer/122001">other</a><span>Hoa h\u1ed3ng 9%</span></div>
      <div class="product-card"><a href="/offer/product_offer/22001">Noi com</a><div><span>\u20ab449.000</span><span>Hoa h\u1ed3ng 7,5%</span><span>XTRA 3%</span></div></div>`;
    expect(readOfferResults(OFFER)).toMatchObject({ state: "found", commissionTexts: ["Hoa h\u1ed3ng 7,5%"], xtraTexts: ["XTRA 3%"], priceText: "\u20ab449.000" });
  });

  it("is waiting before the results load and absent once cards or the empty state show without the item", () => {
    document.body.innerHTML = "<div>loading</div>";
    expect(readOfferResults(OFFER).state).toBe("waiting");
    document.body.innerHTML = '<div class="product-card"><a href="/offer/product_offer/99">x</a></div>';
    expect(readOfferResults(OFFER).state).toBe("absent");
    document.body.innerHTML = '<div class="ant-empty">No data</div>';
    expect(readOfferResults(OFFER).state).toBe("absent");
  });
});

describe("Story 5.6 review items 2 and 3: the page scripts send whole texts and pick out nothing", () => {
  it("item 2: a price range or a from-price is sent whole, never cut to its first amount", () => {
    document.head.innerHTML = '<meta property="og:title" content="Noi com">';
    document.body.innerHTML = '<div class="product-price">\u20ab100.000 - \u20ab200.000</div>';
    expect(readStorefront(STORE).priceText).toBe("\u20ab100.000 - \u20ab200.000");
    document.body.innerHTML = '<div class="product-card"><a href="/offer/product_offer/22001">x</a><span>\u20ab449.000</span><s>\u20ab599.000</s><span>Hoa h\u1ed3ng 7%</span></div>';
    expect(readOfferResults(OFFER)).toMatchObject({ priceText: "\u20ab449.000 \u20ab599.000" });
  });

  it("item 3: a discount badge is not a commission; a label and its percentage in separate elements are sent as their parent's text; XTRA shown without its own percentage is sent with its parent text", () => {
    document.body.innerHTML = '<div class="product-card"><a href="/offer/product_offer/22001">x</a><span>-20%</span><div><span>Hoa h\u1ed3ng</span><span>7,5%</span></div><span>XTRA</span></div>';
    const look = readOfferResults(OFFER);
    expect(look).toMatchObject({ state: "found", commissionTexts: [expect.stringMatching(/^Hoa h.ng7,5%$/)] });
    // The XTRA label's parent is the whole card with two percentages: the server reads no rate from it.
    expect(look.state === "found" && look.xtraTexts).toEqual([expect.stringMatching(/^x-20%Hoa h.ng7,5%XTRA$/)]);
  });

  it("item 3: two commission elements are both sent, so the server can refuse the ambiguity", () => {
    document.body.innerHTML = '<div class="product-card"><a href="/offer/product_offer/22001">x</a><span>Hoa h\u1ed3ng 7,5%</span><span>Commission 10%</span></div>';
    expect(readOfferResults(OFFER)).toMatchObject({ commissionTexts: ["Hoa h\u1ed3ng 7,5%", "Commission 10%"] });
  });
});
