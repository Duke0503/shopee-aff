import { describe, expect, it } from "vitest";
import {
  BaseAffiliateProvider,
  type GeneratedLink,
} from "./base.provider";
import { ProviderRegistry } from "./provider.registry";

class FakeProvider extends BaseAffiliateProvider {
  readonly platform: string;
  constructor(platform: string) {
    super();
    this.platform = platform;
  }
  calls: Array<[string, string]> = [];
  protected async generate(url: string, subId1: string, subId2: string): Promise<GeneratedLink> {
    this.calls.push([subId1, subId2]);
    return { url: `${url}?aff=1&sub_id1=${subId1}&sub_id2=${subId2}` };
  }
}

describe("BaseAffiliateProvider", () => {
  it("recognises its own shop's URLs and nothing else", () => {
    const shopee = new FakeProvider("shopee");
    expect(shopee.canHandle("https://s.shopee.vn/abc")).toBe(true);
    expect(shopee.canHandle("https://shp.ee/abc")).toBe(true);
    expect(shopee.canHandle("https://shopee.vn.evil.com/x")).toBe(false);
    expect(shopee.canHandle("https://tiktok.com/x")).toBe(false);
    expect(shopee.canHandle("not a url")).toBe(false);
  });

  it("passes the customer and request as sub_ids", async () => {
    const shopee = new FakeProvider("shopee");
    const link = await shopee.createAffiliateLink(
      "https://shopee.vn/x-i.1.2",
      "8461752093318820417",
      "R26100612345",
    );
    expect(link).toMatchObject({
      platform: "shopee",
      subId1: "8461752093318820417",
      subId2: "R26100612345",
    });
  });

  it("refuses a customer id a Shopee form would silently break", async () => {
    const shopee = new FakeProvider("shopee");
    await expect(
      shopee.createAffiliateLink("https://shopee.vn/x", "bad-id", "R26100612345"),
    ).rejects.toThrow(/only a-z, A-Z and 0-9/);
    // The provider never even ran.
    expect(shopee.calls).toEqual([]);
  });
});

describe("ProviderRegistry", () => {
  it("picks the provider that recognises the URL", () => {
    const registry = new ProviderRegistry([new FakeProvider("shopee"), new FakeProvider("tiktok")]);
    expect(registry.forUrl("https://vt.tiktok.com/x")?.platform).toBe("tiktok");
    expect(registry.forUrl("https://shopee.vn/x")?.platform).toBe("shopee");
    expect(registry.forUrl("https://example.com/x")).toBeNull();
  });
});
