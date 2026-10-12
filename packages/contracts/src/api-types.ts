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
