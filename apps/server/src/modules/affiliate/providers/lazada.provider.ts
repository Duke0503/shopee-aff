import type { AccessTradePort } from "./accesstrade.client";
import { BaseAffiliateProvider, type GeneratedLink } from "./base.provider";

/** Lazada links are made by AccessTrade (Lazada campaign), with both sub_ids. */
export class LazadaProvider extends BaseAffiliateProvider {
  readonly platform = "lazada";

  constructor(private readonly accessTrade: AccessTradePort) {
    super();
  }

  protected async generate(url: string, subId1: string, subId2: string): Promise<GeneratedLink> {
    const link = await this.accessTrade.createLazadaLink(url, subId1, subId2);
    return { url: link.affiliateUrl };
  }
}
