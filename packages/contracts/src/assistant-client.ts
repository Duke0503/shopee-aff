import { ApiError, type ApiBalance, type ApiBankDetails, type ApiOrder } from "./api-client";

export interface AssistantCustomer {
  customerId: string;
  customerCode: string | null;
  displayName: string | null;
  role: string;
}

export interface AssistantRegistration extends AssistantCustomer {
  created: boolean;
}

export interface AssistantBank {
  hasBank: boolean;
  bankName: string | null;
  bankAccount: string | null;
  accountHolder: string | null;
}

export interface AssistantClient {
  register(input: {
    zaloUserId: string;
    displayName?: string;
    privateChatId?: string;
  }): Promise<AssistantRegistration>;
  resolveCustomer(key: string): Promise<AssistantCustomer>;
  orders(key: string): Promise<ApiOrder[]>;
  balance(key: string): Promise<ApiBalance>;
  bank(key: string): Promise<AssistantBank>;
  issuePassword(key: string): Promise<AssistantCustomer & { password: string }>;
  saveBank(key: string, details: ApiBankDetails): Promise<{ ok: boolean }>;
  eraseBank(key: string): Promise<{ ok: boolean }>;
}

const encode = (value: string): string => encodeURIComponent(value);

/**
 * The assistant's client for the INTERNAL listener (ADR-16). Every call
 * carries `X-Assistant-Token`; the caller's address is never proof of
 * anything. The customer is named in the path, because the assistant acts for
 * many people and holds no session of its own.
 */
export function createAssistantClient(
  fetchImpl: typeof fetch = fetch,
  baseUrl = "",
  token = "",
): AssistantClient {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      headers: { "content-type": "application/json", "x-assistant-token": token },
      ...init,
    });
    if (!response.ok) throw new ApiError(response.status, await response.text());
    return (await response.json()) as T;
  }

  return {
    register: (input) =>
      request<AssistantRegistration>("/internal/customers", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    resolveCustomer: (key) => request<AssistantCustomer>(`/internal/customers/${encode(key)}`),
    orders: (key) => request<ApiOrder[]>(`/internal/customers/${encode(key)}/orders`),
    balance: (key) => request<ApiBalance>(`/internal/customers/${encode(key)}/balance`),
    bank: (key) => request<AssistantBank>(`/internal/customers/${encode(key)}/bank`),
    issuePassword: (key) =>
      request<AssistantCustomer & { password: string }>(
        `/internal/customers/${encode(key)}/password`,
        { method: "POST", body: "{}" },
      ),
    saveBank: (key, details) =>
      request<{ ok: boolean }>(`/internal/customers/${encode(key)}/bank`, {
        method: "POST",
        body: JSON.stringify(details),
      }),
    eraseBank: (key) =>
      request<{ ok: boolean }>(`/internal/customers/${encode(key)}/bank`, { method: "DELETE" }),
  };
}
