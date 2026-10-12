/**
 * The shapes the customer-facing routes answer with — the ones the web app and
 * the bot pages share. The staff console's shapes live in `./api-admin-types`.
 */

export interface ApiCustomer {
  customerId: string;
  customerCode: string | null;
  displayName: string | null;
  role: string;
  hasBankDetails: boolean;
}

export interface ApiOrder {
  orderId: string;
  status: string;
  orderValueVnd: number | null;
  cashbackVnd: number | null;
  recordedAt: string | null;
  paidAt: string | null;
}

export interface ApiConvertResult {
  ready: boolean;
  affiliate_url: string | null;
  request_id: string;
  house: boolean;
}

export interface ApiLinkStatus {
  ready: boolean;
  affiliate_url: string | null;
  status: string;
  notified_at: string | null;
}

/** Web labels, read live from `resources/dashboard.vi.json` by the server. */
export type ApiLabels = Record<string, string>;

export interface ApiPagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

export interface ApiBalance {
  approvedWaitingVnd: number;
  stillWithShopVnd: number;
  alreadyPaidVnd: number;
}

export interface ApiDeal {
  id: string;
  name: string;
  platform: string;
  category: string;
  originalPriceVnd: number;
  salePriceVnd: number;
  cashbackVnd: number;
  imageUrl: string;
  url: string;
}

export interface ApiBankDetails {
  bankName: string;
  bankAccount: string;
  accountHolder: string;
}

/** A coffee-chain voucher. `minOrderFormatted` is the server's own rendering. */
export interface ApiFnbVoucher {
  id: number;
  brand: string;
  title: string;
  description: string;
  voucherType: string;
  code: string;
  barcodeUrl: string;
  affiliateUrl: string;
  discountText: string;
  minOrder: number;
  minOrderFormatted: string;
  startDate: string;
  endDate: string;
  isHot: boolean;
}

export interface ApiFnbVouchers {
  ok: boolean;
  vouchers: ApiFnbVoucher[];
}

export interface ApiFnbDeal {
  id: number;
  brand: string;
  title: string;
  description: string;
  code: string;
  discountText: string;
  affiliateUrl: string;
}

export interface ApiFnbDeals {
  ok: boolean;
  deals: ApiFnbDeal[];
}

/** One cached Shopee product, in the column names the bot reads. */
export interface ApiCachedProduct {
  item_id: string;
  shop_id: string | null;
  name: string | null;
  price: number | null;
  price_formatted: string | null;
  shopee_rate: number | null;
  seller_rate: number | null;
  shopee_part: number | null;
  shopee_part_formatted: string | null;
  seller_part: number | null;
  seller_part_formatted: string | null;
  total_commission: number | null;
  commission_formatted: string | null;
  is_capped: number | null;
  cashback: number | null;
  cashback_formatted: string | null;
  rate_percent: string | null;
  affiliate_url: string | null;
  canonical_url: string | null;
  request_count: number | null;
  first_seen_at: string;
  updated_at: string;
  image_url: string | null;
}

export interface ApiCacheStats {
  ok: boolean;
  total_cached: number;
  with_affiliate_url: number;
  top_products: ApiCachedProduct[];
}

/** `commission_rate` is a fraction (`0.12` is twelve percent). */
export interface ApiTopDeal {
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

export interface ApiTopDeals {
  ok: boolean;
  message?: string;
  products: ApiTopDeal[];
}
