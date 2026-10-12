import { parseCommissionRate, parseVndAmount } from "../domain/accesstrade";
import type { AccessTradeTransaction } from "../domain/accesstrade-order";

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

/** The order side of the API: the commission lines reconciliation reads. */
export interface AccessTradeOrdersPort {
  fetchTransactions(sinceDays?: number): Promise<AccessTradeTransaction[]>;
}

/** A product from the TikTok Shop feed, already parsed out of AccessTrade's shape. */
export interface TopDealProduct {
  productId: string;
  title: string;
  detailLink: string;
  priceVnd: number;
  commissionVnd: number;
  /** A fraction: `0.12` is twelve percent. */
  commissionRate: number;
  imageUrl: string;
  unitsSold: number;
  shopName: string;
}

/** The catalogue side: what is selling well right now. */
export interface AccessTradeFeedPort {
  readonly configured: boolean;
  searchTikTokProducts(keyword: string, limit: number): Promise<TopDealProduct[]>;
}

export interface AccessTradeConfig {
  apiKey: string;
  baseUrl: string;
  lazadaCampaignId: string;
  timeoutMs: number;
  maxPages: number;
}

export const DEFAULT_ACCESSTRADE_BASE_URL = "https://api.accesstrade.vn";
export const DEFAULT_LAZADA_CAMPAIGN_ID = "5087153089503673507";

/** The Nest injection token for the client itself, shared with the registry. */
export const ACCESSTRADE_CLIENT = Symbol("ACCESSTRADE_CLIENT");

export function accessTradeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AccessTradeConfig {
  const timeout = Number(env.ACCESSTRADE_TIMEOUT_MS ?? 10_000);
  const maxPages = Number(env.ACCESSTRADE_MAX_PAGES ?? 10);
  return {
    apiKey: (env.ACCESSTRADE_API_KEY ?? "").trim(),
    baseUrl: (env.ACCESSTRADE_BASE_URL ?? DEFAULT_ACCESSTRADE_BASE_URL).trim().replace(/\/+$/, ""),
    lazadaCampaignId: (env.ACCESSTRADE_LAZADA_CAMPAIGN_ID ?? DEFAULT_LAZADA_CAMPAIGN_ID).trim(),
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 10_000,
    maxPages: Number.isFinite(maxPages) && maxPages > 0 ? maxPages : 10,
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

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export class HttpAccessTrade implements AccessTradePort, AccessTradeOrdersPort, AccessTradeFeedPort {
  constructor(private readonly config: AccessTradeConfig) {}

  /** Without a key there is no API to ask, and the callers fall back. */
  get configured(): boolean {
    return this.config.apiKey !== "";
  }

  private get token(): string {
    return this.config.apiKey.startsWith("Token ") ? this.config.apiKey : `Token ${this.config.apiKey}`;
  }

  private async post(path: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.config.apiKey === "") {
      throw new Error("ACCESSTRADE_API_KEY is not configured");
    }
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: this.token,
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

  /**
   * The TikTok Shop feed, best-selling first. Ports
   * `tiktok_provider.search_products`: rates arrive in hundredths of a percent
   * (1200 is 12%), prices as a `{ minimum_amount }` object.
   */
  async searchTikTokProducts(keyword: string, limit: number): Promise<TopDealProduct[]> {
    if (!this.configured) throw new Error("ACCESSTRADE_API_KEY is not configured");
    const url = new URL(`${this.config.baseUrl}/v1/tiktokshop_product_feeds`);
    url.searchParams.set("sort_field", "units_sold");
    url.searchParams.set("limit", String(limit));
    if (keyword !== "") url.searchParams.set("title_keywords", keyword);
    const response = await fetch(url, {
      headers: { Authorization: this.token, "User-Agent": "CashbackBot/1.0" },
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`AccessTrade /v1/tiktokshop_product_feeds failed: HTTP ${response.status}`);
    }
    const payload = asRecord(await response.json());
    const data = payload.data;
    const products = Array.isArray(data) ? data : asArray(asRecord(data).products);
    return products.map((product) => this.toTopDeal(product));
  }

  private toTopDeal(raw: unknown): TopDealProduct {
    const product = asRecord(raw);
    const commission = asRecord(product.commission);
    const unitsSold = Number(product.units_sold ?? 0);
    return {
      productId: firstString(product.id),
      title: firstString(product.title),
      detailLink: firstString(product.detail_link),
      priceVnd: parseVndAmount(product.original_price),
      commissionVnd: parseVndAmount(commission.amount),
      commissionRate: parseCommissionRate(commission.rate),
      imageUrl: firstString(product.main_image_url),
      unitsSold: Number.isFinite(unitsSold) ? unitsSold : 0,
      shopName: firstString(asRecord(product.shop).name),
    };
  }

  /**
   * The commission lines AccessTrade uses to report orders. `/v1/orders`
   * lacks the sub-id labels an order needs, so only `/v1/transactions` is
   * read. The window stays within 30 days: a 60-day window answered 500.
   */
  async fetchTransactions(sinceDays = 30): Promise<AccessTradeTransaction[]> {
    if (this.config.apiKey === "") {
      throw new Error("ACCESSTRADE_API_KEY is not configured");
    }
    const now = new Date();
    const since = new Date(now.getTime() - Math.min(sinceDays, 30) * 86_400_000);
    const rows: AccessTradeTransaction[] = [];
    for (let page = 1; page <= this.config.maxPages; page += 1) {
      const url = new URL(`${this.config.baseUrl}/v1/transactions`);
      url.searchParams.set("since", `${since.toISOString().slice(0, 10)}T00:00:00Z`);
      url.searchParams.set("until", `${now.toISOString().slice(0, 10)}T23:59:59Z`);
      url.searchParams.set("limit", "100");
      url.searchParams.set("page", String(page));
      const response = await fetch(url, {
        headers: { Authorization: this.token, "User-Agent": "CashbackBot/1.0" },
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      if (!response.ok) throw new Error(`AccessTrade /v1/transactions failed: HTTP ${response.status}`);
      const data = (await response.json()) as unknown;
      const batch = Array.isArray(data) ? data : asArray(asRecord(data).data);
      rows.push(...(batch as AccessTradeTransaction[]));
      const total = Array.isArray(data) ? rows.length : Number(asRecord(data).total ?? 0);
      if (batch.length === 0 || rows.length >= total) break;
    }
    return rows;
  }
}
