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
  adminOrders(status?: string): Promise<ApiOrder[]>;
  payouts(): Promise<ApiPayables>;
  convert(url: string, customerId?: string): Promise<ApiConvertResult>;
  linkStatus(requestId: string): Promise<ApiLinkStatus>;
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
  };
}
