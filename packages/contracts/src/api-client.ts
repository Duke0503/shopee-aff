/**
 * A small typed helper for calling the server, shared by both frontends
 * (ADR-13). The shapes here match the routes the server exposes.
 */
export interface ApiCustomer {
  customerId: string;
  customerCode: string | null;
  displayName: string | null;
  role: string;
  hasBankDetails: boolean;
}

export interface ApiPayable {
  customerId: string;
  amountVnd: number;
  blockedReason: string | null;
  bankChangedRecently: boolean;
}

export interface ApiPayables {
  ready: ApiPayable[];
  blocked: ApiPayable[];
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

/** One row of the admin customer list. Aggregates are stored columns only. */
export interface ApiUserRow {
  customerId: string;
  customerCode: string | null;
  displayName: string | null;
  zaloUserId: string | null;
  bankName: string | null;
  bankAccount: string | null;
  accountHolder: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  loginCount: number;
  status: string;
  orderCount: number;
  totalCashback: number;
  awaitingAmount: number;
  readyAmount: number;
  paidAmount: number;
  lastBotActivity: string | null;
  recentRequests: Array<{ name: string; createdAt: string; affiliateUrl: string | null }>;
}

export interface ApiUsersPage {
  ok: boolean;
  users: ApiUserRow[];
  pagination: ApiPagination;
}

export interface ApiUsersQuery {
  search?: string;
  bank?: "all" | "has_bank" | "no_bank";
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

/** What an order earned, and on what basis. Mirrors the server's breakdown. */
export interface ApiOrderBreakdown {
  basis: "approved" | "estimate" | "none";
  commissionVnd: number;
  serviceFeeVnd: number;
  withheldTaxVnd: number;
  netVnd: number;
  cashbackVnd: number;
  operatorKeepsVnd: number;
  operatorMarginPercent: number;
}

export interface ApiUserOrder {
  orderId: string;
  status: string;
  platform: string;
  settlementStatus: string;
  orderValueVnd: number | null;
  estimatedCommissionVnd: number | null;
  approvedCommissionVnd: number | null;
  cashbackVnd: number;
  rejectionReason: string | null;
  recordedAt: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  productName: string;
  sourceUrl: string | null;
  breakdown: ApiOrderBreakdown;
}

export interface ApiUserRequest {
  requestId: string;
  createdAt: string;
  sourceUrl: string;
  affiliateUrl: string | null;
  platform: string;
  channel: string | null;
  status: string;
  estimatedCommissionVnd: number | null;
  productName: string;
}

export interface ApiUserTransfer {
  id: number;
  amountVnd: number;
  transferCode: string | null;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
  orderIds: string[];
  /** The bill sent to the customer; empty when the row has no token. */
  billPath: string;
  /** The bank screenshot; served only to the customer or to staff. */
  proofPath: string;
}

export interface ApiUserStats {
  totalCashbackVnd: number;
  readyVnd: number;
  awaitingVnd: number;
  paidVnd: number;
  totalOrders: number;
  totalRequests: number;
  totalTransferredVnd: number;
  totalAdminProfitVnd: number;
  periodIsWithheld: boolean;
}

/** One customer's page. Amounts all come from the server. */
export interface ApiUserDetail {
  ok: boolean;
  user: {
    customerId: string;
    customerCode: string | null;
    displayName: string | null;
    zaloUserId: string | null;
    privateChatId: string | null;
    bankName: string | null;
    bankAccount: string | null;
    accountHolder: string | null;
    consentAt: string | null;
    status: string;
    role: string;
    createdAt: string;
    lastLoginAt: string | null;
    loginCount: number;
    lastBotActivity: string | null;
  };
  orders: ApiUserOrder[];
  linkRequests: ApiUserRequest[];
  transfers: ApiUserTransfer[];
  stats: ApiUserStats;
}

export interface ApiRecordTransferInput {
  customerId: string;
  /** Empty means every order of that customer that is approved and unpaid. */
  orderIds?: string[];
  /** What the screen showed; the server refuses a mismatch instead of paying it. */
  amountVnd?: number;
  note?: string;
  transferCode?: string;
  proofImage?: string;
}

export interface ApiRecordTransferResult {
  ok: boolean;
  transferId: number;
  amountVnd: number;
  billToken: string;
  billPath: string;
}

export interface ApiCampaign {
  campaignId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  slots: number;
  bonusVnd: number;
  perCustomer: number;
  status: string;
}

export interface ApiTransfer {
  id: number;
  customerId: string;
  amountVnd: number;
  note: string | null;
  orderIds: string[];
  createdAt: string;
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

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Only the filters that were actually chosen go into the URL. */
function usersQuery(query: ApiUsersQuery = {}): string {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.bank && query.bank !== "all") params.set("bank", query.bank);
  if (query.page !== undefined && query.page > 1) params.set("page", String(query.page));
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.sortBy) params.set("sort_by", query.sortBy);
  if (query.sortOrder) params.set("sort_order", query.sortOrder);
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

export interface ApiClient {
  me(): Promise<ApiCustomer>;
  login(name: string, password: string): Promise<{ customerId: string }>;
  logout(): Promise<{ ok: boolean }>;
  myOrders(): Promise<ApiOrder[]>;
  balance(): Promise<ApiBalance>;
  adminOrders(status?: string): Promise<ApiOrder[]>;
  payouts(): Promise<ApiPayables>;
  convert(url: string, customerId?: string): Promise<ApiConvertResult>;
  linkStatus(requestId: string): Promise<ApiLinkStatus>;
  adminUsers(query?: ApiUsersQuery): Promise<ApiUsersPage>;
  adminUserDetail(customerId: string): Promise<ApiUserDetail>;
  recordTransfer(input: ApiRecordTransferInput): Promise<ApiRecordTransferResult>;
  labels(): Promise<ApiLabels>;
  adminCampaigns(): Promise<ApiCampaign[]>;
  adminTransfers(): Promise<ApiTransfer[]>;
  deals(): Promise<ApiDeal[]>;
  saveBank(details: ApiBankDetails): Promise<{ ok: boolean }>;
}

/** The server's own words when it explains a refusal, the raw body otherwise. */
async function errorMessage(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as { message?: unknown };
    return typeof body.message === "string" ? body.message : text;
  } catch {
    return text;
  }
}

export function createApiClient(fetchImpl: typeof fetch = fetch, baseUrl = ""): ApiClient {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      headers: { "content-type": "application/json" },
      ...init,
    });
    if (!response.ok) throw new ApiError(response.status, await errorMessage(response));
    return (await response.json()) as T;
  }

  return {
    me: () => request<ApiCustomer>("/api/me"),
    login: (name, password) =>
      request<{ customerId: string }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ name, password }),
      }),
    logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST", body: "{}" }),
    myOrders: () => request<ApiOrder[]>("/api/me/orders"),
    balance: () => request<ApiBalance>("/api/me/balance"),
    adminOrders: (status) =>
      request<ApiOrder[]>(
        status ? `/api/admin/orders?status=${encodeURIComponent(status)}` : "/api/admin/orders",
      ),
    payouts: () => request<ApiPayables>("/api/payouts"),
    convert: (url, customerId) =>
      request<ApiConvertResult>("/api/shopee/convert", {
        method: "POST",
        body: JSON.stringify({ url, customerId }),
      }),
    linkStatus: (requestId) =>
      request<ApiLinkStatus>(`/api/shopee/link-status?request_id=${encodeURIComponent(requestId)}`),
    adminUsers: (query) =>
      request<ApiUsersPage>(`/api/admin/users${usersQuery(query)}`),
    adminUserDetail: (customerId) =>
      request<ApiUserDetail>(`/api/admin/users/${encodeURIComponent(customerId)}`),
    recordTransfer: (input) =>
      request<ApiRecordTransferResult>("/api/admin/transfers", {
        method: "POST",
        body: JSON.stringify({
          customer_id: input.customerId,
          order_ids: input.orderIds ?? [],
          amount: input.amountVnd,
          note: input.note,
          transfer_code: input.transferCode,
          proof_image: input.proofImage,
        }),
      }),
    labels: () => request<ApiLabels>("/api/labels"),
    adminCampaigns: () => request<ApiCampaign[]>("/api/admin/campaigns"),
    adminTransfers: () => request<ApiTransfer[]>("/api/admin/transfers"),
    deals: () => request<ApiDeal[]>("/api/deals"),
    saveBank: (details) =>
      request<{ ok: boolean }>("/api/me/bank", {
        method: "POST",
        body: JSON.stringify(details),
      }),
  };
}
