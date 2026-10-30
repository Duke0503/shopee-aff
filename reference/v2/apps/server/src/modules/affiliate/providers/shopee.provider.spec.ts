import { describe, expect, it } from "vitest";

import type { BridgeClient, BridgeJobRequest } from "../../../browser-bridge/bridge.client";
import { ShopeeProvider } from "./shopee.provider";

class FakeBridge implements BridgeClient {
  readonly calls: BridgeJobRequest[] = [];
  constructor(private readonly reply: unknown = "https://s.shopee.vn/aff") {}
  async execute(job: BridgeJobRequest): Promise<unknown> {
    this.calls.push(job);
    return this.reply;
  }
  async connected(): Promise<boolean> {
    return true;
  }
}

describe("ShopeeProvider", () => {
  it("makes a link through the extension with both sub_ids", async () => {
    const bridge = new FakeBridge();
    const link = await new ShopeeProvider(bridge).createAffiliateLink(
      "https://shopee.vn/x-i.1.2",
      "8461752093318820417",
      "R26100612345",
    );
    expect(link).toMatchObject({
      url: "https://s.shopee.vn/aff",
      platform: "shopee",
      subId1: "8461752093318820417",
      subId2: "R26100612345",
    });
    expect(bridge.calls[0]).toMatchObject({
      action: "shopee_custom_link",
      params: {
        productUrl: "https://shopee.vn/x-i.1.2",
        subId1: "8461752093318820417",
        subId2: "R26100612345",
      },
    });
  });

  it("reads a structured result too", async () => {
    const bridge = new FakeBridge({ affiliateUrl: "https://s.shopee.vn/other" });
    const link = await new ShopeeProvider(bridge).createAffiliateLink("https://shopee.vn/x", "1", "R1");
    expect(link.url).toBe("https://s.shopee.vn/other");
  });

  it("never calls the extension with a broken sub_id", async () => {
    const bridge = new FakeBridge();
    await expect(
      new ShopeeProvider(bridge).createAffiliateLink("https://shopee.vn/x", "bad-id", "R1"),
    ).rejects.toThrow(/only a-z, A-Z and 0-9/);
    expect(bridge.calls).toEqual([]);
  });

  it("fails cleanly when the extension returns nothing", async () => {
    await expect(
      new ShopeeProvider(new FakeBridge("")).createAffiliateLink("https://shopee.vn/x", "1", "R1"),
    ).rejects.toThrow(/no link/);
  });
});
