import { formatVnd, type Messages } from "../../../notifications";
import type { AccessTradeFeedPort, TopDealProduct } from "../providers/accesstrade.client";

/**
 * The best-selling TikTok Shop products of the moment, as the bot shows them.
 * The keys are snake_case because the assistant already reads them that way.
 */
export interface TopDealView {
  title: string;
  detail_link: string;
  price: number;
  price_formatted: string;
  commission_rate: number;
  commission_rate_pct: number;
  commission_amount: number;
  image_url: string;
  units_sold: number;
  shop_name: string;
  product_id: string;
}

export interface TopDealsResult {
  ok: boolean;
  message?: string;
  products: TopDealView[];
}

export interface TopDealsQuery {
  keyword?: string;
  limit?: number;
}

const MAX_LIMIT = 20;

/** Display only: a rate percent is a label, never money. */
function ratePercent(rate: number): number {
  return Math.round(rate * 1000) / 10;
}

export async function listTopDeals(
  port: AccessTradeFeedPort,
  messages: Messages,
  query: TopDealsQuery = {},
): Promise<TopDealsResult> {
  if (!port.configured) {
    return { ok: false, message: "TikTok provider not configured", products: [] };
  }

  const requested = query.limit ?? 5;
  const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 5, 1), MAX_LIMIT);

  let products: TopDealProduct[] = [];
  try {
    products = await port.searchTikTokProducts((query.keyword ?? "").trim(), limit);
  } catch {
    // The bot has its own "nothing to show yet" message, so an unreachable
    // feed is answered with an empty list rather than an error.
    products = [];
  }

  return {
    ok: true,
    products: products.map((product) => ({
      title: product.title,
      detail_link: product.detailLink,
      price: product.priceVnd,
      price_formatted: product.priceVnd > 0 ? formatVnd(messages, product.priceVnd) : "N/A",
      commission_rate: product.commissionRate,
      commission_rate_pct: ratePercent(product.commissionRate),
      commission_amount: product.commissionVnd,
      image_url: product.imageUrl,
      units_sold: product.unitsSold,
      shop_name: product.shopName,
      product_id: product.productId,
    })),
  };
}
