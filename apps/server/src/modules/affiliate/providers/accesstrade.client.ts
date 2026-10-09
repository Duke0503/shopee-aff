import { parseCommissionRate, parseVndAmount } from "../domain/accesstrade";

/**
 * Talks to the AccessTrade Publisher API, which makes TikTok Shop and Lazada
 * affiliate links. Ports `providers/tiktok_provider.py` and
 * `providers/lazada_provider.py`'s `_call_accesstrade_create_link`.
 */
export interface AccessTradeLink {
  affiliateUrl: string;
  productName: string;
  productImage: string;
  priceVnd: number;
  commissionVnd: number;
  commissionRate: number;
}

export interface AccessTradePort {
  createTikTokLink(productUrl: string, subId1: string, subId2: string): Promise<AccessTradeLink>;
  createLazadaLink(productUrl: string, subId1: string, subId2: string): Promise<AccessTradeLink>;
}

export interface AccessTradeConfig {
  apiKey: string;
  baseUrl: string;
  lazadaCampaignId: string;
  timeoutMs: number;
}

export const DEFAULT_ACCESSTRADE_BASE_URL = "https://api.accesstrade.vn";
export const DEFAULT_LAZADA_CAMPAIGN_ID = "5087153089503673507";

export function accessTradeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AccessTradeConfig {
  const timeout = Number(env.ACCESSTRADE_TIMEOUT_MS ?? 10_000);
  return {
    apiKey: (env.ACCESSTRADE_API_KEY ?? "").trim(),
    baseUrl: (env.ACCESSTRADE_BASE_URL ?? DEFAULT_ACCESSTRADE_BASE_URL).trim().replace(/\/+$/, ""),
    lazadaCampaignId: (env.ACCESSTRADE_LAZADA_CAMPAIGN_ID ?? DEFAULT_LAZADA_CAMPAIGN_ID).trim(),
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 10_000,
  };
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export class HttpAccessTrade implements AccessTradePort {
  constructor(private readonly config: AccessTradeConfig) {}

  private async post(path: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.config.apiKey === "") {
      throw new Error("ACCESSTRADE_API_KEY is not configured");
    }
    const token = this.config.apiKey.startsWith("Token ") ? this.config.apiKey : `Token ${this.config.apiKey}`;
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/json",
        "User-Agent": "CashbackBot/1.0",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    if (!response.ok) throw new Error(`AccessTrade ${path} failed: HTTP ${response.status}`);
    return asRecord(await response.json());
  }

  async createTikTokLink(productUrl: string, subId1: string, subId2: string): Promise<AccessTradeLink> {
    const res = await this.post("/v2/tiktokshop_product_feeds/create_link", {
      product_url: productUrl,
      sub1: subId1,
      sub2: subId2,
      sub_1: subId1,
      sub_2: subId2,
      utm_source: "cashback_bot",
      utm_medium: "zalo_web",
    });
    const data = asRecord(res.data ?? res);
    const affiliateUrl = firstString(data.aff_short_url, data.aff_url, res.aff_short_url, res.aff_url);
    if (affiliateUrl === "") throw new Error("AccessTrade returned no TikTok affiliate link");
    return {
      affiliateUrl,
      productName: firstString(data.product_name, res.product_name),
      productImage: firstString(data.product_image, data.image, res.product_image),
      priceVnd: parseVndAmount(data.product_price ?? res.product_price),
      commissionVnd: parseVndAmount(data.product_commission ?? res.product_commission),
      commissionRate: parseCommissionRate(data.commission ?? res.commission),
    };
  }

  async createLazadaLink(productUrl: string, subId1: string, subId2: string): Promise<AccessTradeLink> {
    const res = await this.post("/v1/product_link/create", {
      campaign_id: this.config.lazadaCampaignId,
      urls: [productUrl],
      sub1: subId1,
      sub2: subId2,
      sub3: "cashback",
      utm_source: "cashback_bot",
    });
    const list = Array.isArray(res.data) ? res.data : [];
    const first = asRecord(list[0]);
    const affiliateUrl = firstString(first.short_url, first.aff_link, res.short_url, res.aff_link);
    if (affiliateUrl === "") throw new Error("AccessTrade returned no Lazada affiliate link");
    return {
      affiliateUrl,
      productName: firstString(first.product_name, res.product_name),
      productImage: firstString(first.product_image, res.product_image),
      priceVnd: parseVndAmount(first.product_price ?? res.product_price),
      commissionVnd: parseVndAmount(first.product_commission ?? res.product_commission),
      commissionRate: parseCommissionRate(first.commission ?? res.commission),
    };
  }
}
