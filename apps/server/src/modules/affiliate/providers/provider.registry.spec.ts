import { describe, expect, it } from "vitest";

import type { BridgeClient, BridgeJobRequest } from "../../../browser-bridge/bridge.client";
import type { AccessTradePort } from "./accesstrade.client";
import { createProviderRegistry } from "./provider.registry";

const accessTrade: AccessTradePort = {
  async createTikTokLink() {
    throw new Error("not used");
  },
  async createLazadaLink() {
    throw new Error("not used");
  },
};

const bridge: BridgeClient = {
  async execute(_job: BridgeJobRequest) {
    throw new Error("not used");
  },
  async connected() {
    return true;
  },
};

describe("createProviderRegistry", () => {
  it("routes every shop to its provider", () => {
    const registry = createProviderRegistry({ accessTrade, bridge });

    expect(registry.forUrl("https://www.tiktok.com/x")?.platform).toBe("tiktok");
    expect(registry.forUrl("https://www.lazada.vn/x")?.platform).toBe("lazada");
    expect(registry.forUrl("https://shopee.vn/x")?.platform).toBe("shopee");
    expect(registry.forUrl("https://food.shopee.vn/x")?.platform).toBe("shopeefood");
    expect(registry.forUrl("https://shopeefood.vn/x")?.platform).toBe("shopeefood");
    expect(registry.forUrl("https://example.com/x")).toBeNull();
  });

  it("leaves Shopee unhandled while the bridge is not wired", () => {
    const registry = createProviderRegistry({ accessTrade, bridge: null });

    expect(registry.forUrl("https://shopee.vn/x")).toBeNull();
    expect(registry.forUrl("https://food.shopee.vn/x")).toBeNull();
    expect(registry.forUrl("https://www.tiktok.com/x")?.platform).toBe("tiktok");
  });
});
