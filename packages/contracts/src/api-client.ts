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
  payouts(): Promise<ApiPayables>;
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
    payouts: () => request<ApiPayables>("/api/payouts"),
  };
}
