import type { ApiAdminOrdersQuery, ApiConfirmPayoutInput, ApiMarkPaidInput, ApiRecordTransferInput, ApiUsersQuery } from "./api-admin-types";
import type {
  ApiAdminOrdersPage,
  ApiCampaign,
  ApiConfirmPayoutResult,
  ApiMarkPaidResult,
  ApiPaymentPlan,
  ApiPaymentsPage,
  ApiRecordTransferResult,
  ApiTransfer,
  ApiUserDetail,
  ApiUsersPage,
} from "./api-admin-types";
import type {
  ApiBalance,
  ApiBankDetails,
  ApiConvertResult,
  ApiCustomer,
  ApiDeal,
  ApiLabels,
  ApiLinkStatus,
  ApiOrder,
} from "./api-types";

/**
 * A small typed helper for calling the server, shared by both frontends
 * (ADR-13). The shapes it moves live in `./api-types` (the customer surface)
 * and `./api-admin-types` (the staff console); both are re-exported here, so
 * everything is imported from `@mmo/contracts`.
 */
export * from "./api-types";
export * from "./api-admin-types";

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

/** The order list's filters, same rule: an unchosen filter is not sent. */
function ordersQuery(query: ApiAdminOrdersQuery = {}): string {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.status && query.status !== "all") params.set("status", query.status);
  if (query.settlementStatus && query.settlementStatus !== "all") {
    params.set("settlement_status", query.settlementStatus);
  }
  if (query.platform && query.platform !== "all") params.set("platform", query.platform);
  if (query.customerId) params.set("customer_id", query.customerId);
  if (query.fromDate) params.set("from_date", query.fromDate);
  if (query.toDate) params.set("to_date", query.toDate);
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
  adminOrders(query?: ApiAdminOrdersQuery): Promise<ApiAdminOrdersPage>;
  markOrdersPaid(input: ApiMarkPaidInput): Promise<ApiMarkPaidResult>;
  payouts(): Promise<ApiPaymentsPage>;
  paymentPlan(customerId: string): Promise<ApiPaymentPlan>;
  confirmPayout(input: ApiConfirmPayoutInput): Promise<ApiConfirmPayoutResult>;
  askForBank(customerId: string): Promise<{ ok: boolean }>;
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

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

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

/** What a signed-in customer's own pages need. */
function customerClient(request: Request): Pick<
  ApiClient,
  "me" | "login" | "logout" | "myOrders" | "balance" | "convert" | "linkStatus" | "deals" | "saveBank"
> {
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
    convert: (url, customerId) =>
      request<ApiConvertResult>("/api/shopee/convert", {
        method: "POST",
        body: JSON.stringify({ url, customerId }),
      }),
    linkStatus: (requestId) =>
      request<ApiLinkStatus>(`/api/shopee/link-status?request_id=${encodeURIComponent(requestId)}`),
    deals: () => request<ApiDeal[]>("/api/deals"),
    saveBank: (details) =>
      request<{ ok: boolean }>("/api/me/bank", {
        method: "POST",
        body: JSON.stringify(details),
      }),
  };
}

/** What the staff console reads. */
function staffReadClient(request: Request): Pick<
  ApiClient,
  | "labels"
  | "adminOrders"
  | "payouts"
  | "paymentPlan"
  | "adminUsers"
  | "adminUserDetail"
  | "adminCampaigns"
  | "adminTransfers"
> {
  return {
    labels: () => request<ApiLabels>("/api/labels"),
    adminOrders: (query) => request<ApiAdminOrdersPage>(`/api/admin/orders${ordersQuery(query)}`),
    payouts: () => request<ApiPaymentsPage>("/api/admin/payments"),
    paymentPlan: (customerId) =>
      request<ApiPaymentPlan>(
        `/api/admin/payments/plan?customer_id=${encodeURIComponent(customerId)}`,
      ),
    adminUsers: (query) => request<ApiUsersPage>(`/api/admin/users${usersQuery(query)}`),
    adminUserDetail: (customerId) =>
      request<ApiUserDetail>(`/api/admin/users/${encodeURIComponent(customerId)}`),
    adminCampaigns: () => request<ApiCampaign[]>("/api/admin/campaigns"),
    adminTransfers: () => request<ApiTransfer[]>("/api/admin/transfers"),
  };
}

/** The staff writes: each one records something that already happened. */
function staffWriteClient(request: Request): Pick<
  ApiClient,
  "markOrdersPaid" | "confirmPayout" | "askForBank" | "recordTransfer"
> {
  return {
    markOrdersPaid: (input) =>
      request<ApiMarkPaidResult>("/api/admin/orders/mark-paid", {
        method: "POST",
        body: JSON.stringify({ customer_id: input.customerId, order_ids: input.orderIds }),
      }),
    confirmPayout: (input) =>
      request<ApiConfirmPayoutResult>("/api/admin/payments/confirm", {
        method: "POST",
        body: JSON.stringify({
          customer_id: input.customerId,
          order_ids: input.orderIds,
          note: input.note ?? "",
          transfer_code: input.transferCode ?? "",
        }),
      }),
    askForBank: (customerId) =>
      request<{ ok: boolean }>("/api/admin/payments/ask-bank", {
        method: "POST",
        body: JSON.stringify({ customer_id: customerId }),
      }),
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
  };
}

export function createApiClient(fetchImpl: typeof fetch = fetch, baseUrl = ""): ApiClient {
  const request: Request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      headers: { "content-type": "application/json" },
      ...init,
    });
    if (!response.ok) throw new ApiError(response.status, await errorMessage(response));
    return (await response.json()) as T;
  };

  return {
    ...customerClient(request),
    ...staffReadClient(request),
    ...staffWriteClient(request),
  };
}
