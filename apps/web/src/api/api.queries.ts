/**
 * The website's one way to call the server (code.md §10): same-origin JSON on /api with the
 * customer cookie the server set, and the one error envelope (AD-20) turned into an `ApiError`.
 * Only `*.queries.ts` files call it; components never fetch.
 */
import { errorEnvelopeSchema } from "@cashback/contracts";

export class ApiError extends Error {
  constructor(
    readonly status: number | null,
    readonly code: string,
    readonly messageKey: string,
    readonly fields: Readonly<Record<string, string>> = {},
  ) {
    super(code);
    this.name = "ApiError";
  }
}

export interface ApiRequest {
  readonly method?: "GET" | "POST" | "DELETE";
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

async function errorOf(response: Response): Promise<ApiError> {
  const body: unknown = await response.json().catch(() => null);
  const envelope = errorEnvelopeSchema.safeParse(body);
  if (!envelope.success) return new ApiError(response.status, "internal", "error.internal");
  const { code, messageKey, fields } = envelope.data.error;
  return new ApiError(response.status, code, messageKey, fields);
}

export async function apiRequest(path: string, { method = "GET", body, signal }: ApiRequest = {}): Promise<unknown> {
  const headers: Record<string, string> = { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) };
  let response: Response;
  try {
    response = await fetch(path, { method, credentials: "same-origin", headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...(signal === undefined ? {} : { signal }) });
  } catch (error) {
    if (signal?.aborted === true) throw error;
    throw new ApiError(null, "network", "error.network");
  }
  if (!response.ok) throw await errorOf(response);
  return response.json() as Promise<unknown>;
}

export const isUnauthorized = (error: unknown): boolean => error instanceof ApiError && error.status === 401;
