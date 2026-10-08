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

export interface ApiCustomerProfile {
  customerId: string;
  customerCode: string | null;
  displayName: string | null;
  role: string;
  hasBankDetails: boolean;
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
  adminCustomers(query?: string): Promise<ApiCustomerProfile[]>;
  adminCampaigns(): Promise<ApiCampaign[]>;
  adminTransfers(): Promise<ApiTransfer[]>;
  deals(): Promise<ApiDeal[]>;
  saveBank(details: ApiBankDetails): Promise<{ ok: boolean }>;
}

export function createApiClient(fetchImpl: typeof fetch = fetch, baseUrl = ""): ApiClient {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      headers: { "content-type": "application/json" },
      ...init,
    });
    if (!response.ok) throw new ApiError(response.status, await response.text());
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
    adminCustomers: (query) =>
      request<ApiCustomerProfile[]>(
        query ? `/api/admin/customers?q=${encodeURIComponent(query)}` : "/api/admin/customers",
      ),
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
