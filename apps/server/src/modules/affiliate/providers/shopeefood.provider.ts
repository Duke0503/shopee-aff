import type { BridgeClient } from "../../../browser-bridge/bridge.client";
import { BaseAffiliateProvider, type GeneratedLink } from "./base.provider";
import type { ShopeeLinkResult } from "./shopee.provider";

/**
 * ShopeeFood links use Shopee's own custom-link generator in the extension,
 * the same job Shopee uses. It is a separate provider only because the shops
 * are separate domains (`shopeefood.vn`, `food.shopee.vn`).
 */
export class ShopeeFoodProvider extends BaseAffiliateProvider {
  readonly platform = "shopeefood";

  constructor(
    private readonly bridge: BridgeClient,
    private readonly timeoutMs = 300_000,
  ) {
    super();
  }

  protected async generate(url: string, subId1: string, subId2: string): Promise<GeneratedLink> {
    const result = await this.bridge.execute({
      action: "shopee_custom_link",
      params: { productUrl: url, subId1, subId2 },
      timeoutMs: this.timeoutMs,
    });
    const affiliateUrl =
      typeof result === "string" ? result : ((result as ShopeeLinkResult | null)?.affiliateUrl ?? "");
    if (affiliateUrl === "") throw new Error("the extension returned no link");
    return { url: affiliateUrl };
  }
}
