import { describe, expect, it } from "vitest";

import type { AccessTradeLink, AccessTradePort } from "./accesstrade.client";
import { LazadaProvider } from "./lazada.provider";
import { TikTokProvider } from "./tiktok.provider";

class FakeAccessTrade implements AccessTradePort {
  readonly calls: Array<{ kind: string; url: string; subId1: string; subId2: string }> = [];

  constructor(private readonly reply = "https://aff.example/abc") {}

  private result(): AccessTradeLink {
    return {
      affiliateUrl: this.reply,
      productName: "San pham",
      productImage: "",
      priceVnd: 100_000,
      commissionVnd: 10_000,
      commissionRate: 0.1,
    };
  }

  async createTikTokLink(url: string, subId1: string, subId2: string): Promise<AccessTradeLink> {
    this.calls.push({ kind: "tiktok", url, subId1, subId2 });
    return this.result();
  }

  async createLazadaLink(url: string, subId1: string, subId2: string): Promise<AccessTradeLink> {
    this.calls.push({ kind: "lazada", url, subId1, subId2 });
    return this.result();
  }
}

describe("TikTokProvider / LazadaProvider", () => {
  it("hands both sub_ids to AccessTrade and returns its link", async () => {
    const port = new FakeAccessTrade();
    const link = await new TikTokProvider(port).createAffiliateLink("https://www.tiktok.com/x", "C1", "R1");

    expect(link).toMatchObject({
      url: "https://aff.example/abc",
      platform: "tiktok",
      subId1: "C1",
      subId2: "R1",
    });
    expect(port.calls).toEqual([{ kind: "tiktok", url: "https://www.tiktok.com/x", subId1: "C1", subId2: "R1" }]);
  });

  it("uses the Lazada call for Lazada", async () => {
    const port = new FakeAccessTrade();
    const link = await new LazadaProvider(port).createAffiliateLink("https://www.lazada.vn/x-i1", "C1", "R1");

    expect(link.platform).toBe("lazada");
    expect(port.calls[0]?.kind).toBe("lazada");
  });

  it("refuses an unsafe sub_id before it reaches the network", async () => {
    const port = new FakeAccessTrade();
    await expect(
      new TikTokProvider(port).createAffiliateLink("https://www.tiktok.com/x", "bad-id", "R1"),
    ).rejects.toThrow();
    expect(port.calls).toHaveLength(0);
  });
});
