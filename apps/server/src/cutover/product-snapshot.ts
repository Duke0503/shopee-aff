/**
 * The product snapshot of an imported link request (D56): name, image, price and rates, taken
 * once from what the live system knew and never resolved again at read time. The live screens
 * resolved them on every read through the fallbacks of `_resolve_product_info`
 * (web/dashboard.py:255-334); the import walks the same tiers once: the request's stored
 * estimate (`estimate_detail`, shopee/commission.py:39-96), then `products_cache` by affiliate
 * URL, by canonical URL equal to the source URL, and by item id (the one saved with the
 * estimate, else the one in a Shopee product URL, shopee/dashboard_lookup.py:90-182). A field
 * the estimate lacks is taken from the cache row. Live rates are percent floats; they become
 * integer basis points only when exact, and are otherwise left out and reported.
 */
import type BetterSqlite3 from "better-sqlite3";

import { wholeDong } from "./live-values";

/** A quoted price of 0 says nothing about the product. */
export const PRICE = { allowZero: false } as const;

export interface LiveProduct {
  item_id: string;
  shop_id: string | null;
  name: string | null;
  price: number | null;
  shopee_rate: number | null;
  seller_rate: number | null;
  affiliate_url: string | null;
  canonical_url: string | null;
  image_url: string | null;
  first_seen_at: unknown;
  updated_at: unknown;
}

export interface Snapshot {
  productOfferId: string | null;
  productName: string | null;
  productImageUrl: string | null;
  productPrice: number | null;
  shopeeRateBps: number | null;
  sellerRateBps: number | null;
  /** Where the name came from, for the report. */
  source: "estimate" | "product_cache" | "none";
  problems: string[];
}

interface Estimate {
  name?: unknown;
  image_url?: unknown;
  price?: unknown;
  shopee_rate?: unknown;
  seller_rate?: unknown;
  item_id?: unknown;
}

const IDS_FROM_URL = /\/([^/?#]*?)-i\.(\d+)\.(\d+)/;
const IDS_FROM_PATH = /\/(\d{5,})\/(\d{5,})(?:[/?#]|$)/;

/** The Shopee item id in a product URL, as live `parse_url` reads it. */
export function itemIdOf(url: string | null): string | null {
  if (!url) return null;
  return IDS_FROM_URL.exec(url)?.[3] ?? IDS_FROM_PATH.exec(url)?.[2] ?? null;
}

const PERCENT = /^(\d+)(?:\.(\d{1,2}))?$/;

/** A live percent (`3.5`) as basis points (350), read from its decimal text so no float maths is needed. */
export function percentToBps(value: unknown): number | null | "inexact" {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "inexact";
  const m = PERCENT.exec(String(value));
  if (!m) return "inexact";
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

function readEstimate(text: string | null, problems: string[]): Estimate | null {
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Estimate;
  } catch {
    // Unreadable live JSON is reported like any other value that fits no rule.
  }
  problems.push("estimate_detail");
  return null;
}

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);

export class ProductCache {
  private readonly byItem = new Map<string, LiveProduct>();
  private readonly byAffiliate = new Map<string, LiveProduct>();
  private readonly byCanonical = new Map<string, LiveProduct>();

  constructor(readonly rows: readonly LiveProduct[]) {
    for (const row of rows) {
      this.byItem.set(row.item_id, row);
      const named = text(row.name) !== null;
      if (named && row.affiliate_url && !this.byAffiliate.has(row.affiliate_url)) this.byAffiliate.set(row.affiliate_url, row);
      if (named && row.canonical_url && !this.byCanonical.has(row.canonical_url)) this.byCanonical.set(row.canonical_url, row);
    }
  }

  static read(source: BetterSqlite3.Database): ProductCache {
    return new ProductCache(source.prepare("SELECT * FROM products_cache ORDER BY item_id").all() as LiveProduct[]);
  }

  find(estimate: Estimate | null, request: { affiliate_url: string | null; source_url: string }): LiveProduct | null {
    const tiers = [
      request.affiliate_url ? this.byAffiliate.get(request.affiliate_url) : undefined,
      this.byCanonical.get(request.source_url),
      ...[text(estimate?.item_id) ?? (typeof estimate?.item_id === "number" ? String(estimate.item_id) : null), itemIdOf(request.source_url), itemIdOf(request.affiliate_url)].map((id) =>
        id === null ? undefined : this.byItem.get(id),
      ),
    ];
    return tiers.find((row) => row !== undefined) ?? null;
  }
}

function rate(estimateValue: unknown, cacheValue: unknown, column: string, problems: string[]): number | null {
  const value = estimateValue ?? cacheValue;
  const bps = percentToBps(value);
  if (bps === "inexact") {
    problems.push(column);
    return null;
  }
  return bps;
}

export function snapshotOf(request: { estimate_detail: string | null; affiliate_url: string | null; source_url: string }, cache: ProductCache): Snapshot {
  const problems: string[] = [];
  const estimate = readEstimate(request.estimate_detail, problems);
  const product = cache.find(estimate, request);
  const estimateName = text(estimate?.name);
  const name = estimateName ?? text(product?.name);
  return {
    productOfferId: product?.item_id ?? null,
    productName: name,
    productImageUrl: text(estimate?.image_url) ?? text(product?.image_url),
    productPrice: wholeDong(estimate?.price, PRICE) ?? wholeDong(product?.price, PRICE),
    shopeeRateBps: rate(estimate?.shopee_rate, product?.shopee_rate, "shopee_rate", problems),
    sellerRateBps: rate(estimate?.seller_rate, product?.seller_rate, "seller_rate", problems),
    source: estimateName !== null ? "estimate" : name !== null ? "product_cache" : "none",
    problems,
  };
}
