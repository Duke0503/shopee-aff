import { describe, expect, it, vi } from "vitest";

import type { TopDealProduct, AccessTradeFeedPort } from "../providers/accesstrade.client";
import { listTopDeals } from "./list-top-deals.use-case";

const MESSAGES = { thousands_separator: ".", currency: "đ" };

const PRODUCT: TopDealProduct = {
  productId: "1729",
  title: "Tai nghe bluetooth",
  detailLink: "https://www.tiktok.com/view/product/1729",
  priceVnd: 250_000,
  commissionVnd: 30_000,
  commissionRate: 0.125,
  imageUrl: "https://img.example/1729.jpg",
  unitsSold: 4321,
  shopName: "Shop",
};

function port(overrides: Partial<AccessTradeFeedPort> = {}): AccessTradeFeedPort {
  return {
    configured: true,
    searchTikTokProducts: vi.fn(async () => [PRODUCT]),
    ...overrides,
  };
}

describe("listTopDeals", () => {
  it("answers the feed in the shape the bot already reads", async () => {
    const result = await listTopDeals(port(), MESSAGES, { limit: 5 });

    expect(result).toEqual({
      ok: true,
      products: [
        {
          title: "Tai nghe bluetooth",
          detail_link: "https://www.tiktok.com/view/product/1729",
          price: 250_000,
          price_formatted: "250.000đ",
          commission_rate: 0.125,
          commission_rate_pct: 12.5,
          commission_amount: 30_000,
          image_url: "https://img.example/1729.jpg",
          units_sold: 4321,
          shop_name: "Shop",
          product_id: "1729",
        },
      ],
    });
  });

  it("says so when there is no TikTok provider", async () => {
    const result = await listTopDeals(port({ configured: false }), MESSAGES, {});
    expect(result).toEqual({ ok: false, message: "TikTok provider not configured", products: [] });
  });

  it("asks for no more than twenty and never fewer than one", async () => {
    const wide = port();
    await listTopDeals(wide, MESSAGES, { limit: 500 });
    expect(wide.searchTikTokProducts).toHaveBeenCalledWith("", 20);

    const narrow = port();
    await listTopDeals(narrow, MESSAGES, { limit: 0 });
    expect(narrow.searchTikTokProducts).toHaveBeenCalledWith("", 1);
  });

  it("answers with an empty list when the feed cannot be reached", async () => {
    const failing = port({
      searchTikTokProducts: vi.fn(async () => {
        throw new Error("HTTP 500");
      }),
    });
    expect(await listTopDeals(failing, MESSAGES, {})).toEqual({ ok: true, products: [] });
  });

  it("shows no price rather than a wrong one when the feed has none", async () => {
    const free = port({ searchTikTokProducts: vi.fn(async () => [{ ...PRODUCT, priceVnd: 0 }]) });
    const result = await listTopDeals(free, MESSAGES, {});
    expect(result.products[0]?.price_formatted).toBe("N/A");
  });

  it("passes the keyword through", async () => {
    const searching = port();
    await listTopDeals(searching, MESSAGES, { keyword: " tai nghe " });
    expect(searching.searchTikTokProducts).toHaveBeenCalledWith("tai nghe", 5);
  });
});
