import { describe, expect, it } from "vitest";

import type { BridgeClient, BridgeJobRequest } from "../../../browser-bridge/bridge.client";
import { ShopeeFoodProvider } from "./shopeefood.provider";

class FakeBridge implements BridgeClient {
  readonly calls: BridgeJobRequest[] = [];

  constructor(private readonly reply: unknown = "https://s.shopee.vn/food") {}

  async execute(job: BridgeJobRequest): Promise<unknown> {
    this.calls.push(job);
    return this.reply;
  }

  async connected(): Promise<boolean> {
    return true;
  }
}

describe("ShopeeFoodProvider", () => {
  it("uses the extension custom-link job with both sub_ids", async () => {
    const bridge = new FakeBridge();
    const link = await new ShopeeFoodProvider(bridge).createAffiliateLink(
      "https://shopeefood.vn/quan/an",
      "C1",
      "R1",
    );

    expect(link).toMatchObject({
      url: "https://s.shopee.vn/food",
      platform: "shopeefood",
      subId1: "C1",
      subId2: "R1",
    });
    expect(bridge.calls[0]).toMatchObject({
      action: "shopee_custom_link",
      params: { productUrl: "https://shopeefood.vn/quan/an", subId1: "C1", subId2: "R1" },
    });
  });

  it("fails when the extension returns no link", async () => {
    const bridge = new FakeBridge("");
    await expect(
      new ShopeeFoodProvider(bridge).createAffiliateLink("https://shopeefood.vn/x", "C1", "R1"),
    ).rejects.toThrow();
  });
});
