import { toSubId } from "../domain/sub-id";
import { belongsTo } from "../infrastructure/shop-hosts";

/**
 * One affiliate platform. The parent fixes the order of the steps and keeps
 * the `sub_id` safety check, so NO provider can forget it; each platform
 * fills in only how a link is actually made (the template method pattern).
 */
export interface GeneratedLink {
  url: string;
}

export interface AffiliateLink {
  url: string;
  platform: string;
  requestId: string;
  subId1: string;
  subId2: string;
}

export abstract class BaseAffiliateProvider {
  abstract readonly platform: string;

  canHandle(url: string): boolean {
    try {
      return belongsTo(new URL(url).hostname, this.platform);
    } catch {
      return false;
    }
  }

  async createAffiliateLink(
    url: string,
    customerId: string,
    requestId: string,
  ): Promise<AffiliateLink> {
    const subId1 = toSubId(customerId, "customer_id");
    const subId2 = toSubId(requestId, "request_id");
    const link = await this.generate(url, subId1, subId2);
    return { url: link.url, platform: this.platform, requestId, subId1, subId2 };
  }

  protected abstract generate(
    url: string,
    subId1: string,
    subId2: string,
  ): Promise<GeneratedLink>;
}
