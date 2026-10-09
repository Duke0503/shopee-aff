import type { AccessTradePort } from "./accesstrade.client";
import { BaseAffiliateProvider, type GeneratedLink } from "./base.provider";

/** TikTok Shop links are made by AccessTrade, which stamps both sub_ids. */
export class TikTokProvider extends BaseAffiliateProvider {
  readonly platform = "tiktok";

  constructor(private readonly accessTrade: AccessTradePort) {
    super();
  }

  protected async generate(url: string, subId1: string, subId2: string): Promise<GeneratedLink> {
    const link = await this.accessTrade.createTikTokLink(url, subId1, subId2);
    return { url: link.affiliateUrl };
  }
}
