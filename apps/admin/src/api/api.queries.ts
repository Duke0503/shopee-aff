/**
 * The admin desk's one way to call the server (code.md §10): same-origin JSON on /api/admin with
 * the staff cookie the server set, and the one error envelope (AD-20) turned into an `ApiError`.
 * A proof image is the one body that is not JSON (`file`). Only `*.queries.ts` files call it;
 * components never fetch.
 */
import { errorEnvelopeSchema } from "@cashback/contracts";
import { ListFetchError } from "@cashback/ui";

export class ApiError extends ListFetchError {
  constructor(
    status: number | null,
    readonly code: string,
    readonly messageKey: string,
    readonly fields: Readonly<Record<string, string>> = {},
  ) {
    super(status);
    this.name = "ApiError";
  }
}

export interface ApiRequest {
  readonly method?: "GET" | "POST" | "DELETE";
  /** Sent as JSON. */
  readonly body?: unknown;
  /** Sent as the raw body with its own content type (a proof image); not with `body`. */
  readonly file?: Blob;
  readonly signal?: AbortSignal;
}

function sendOf({ body, file }: ApiRequest): { headers: Record<string, string>; body?: BodyInit } {
  if (file !== undefined) return { headers: { accept: "application/json", "content-type": file.type }, body: file };
  if (body !== undefined) return { headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(body) };
  return { headers: { accept: "application/json" } };
}

async function errorOf(response: Response): Promise<ApiError> {
  const body: unknown = await response.json().catch(() => null);
  const envelope = errorEnvelopeSchema.safeParse(body);
  if (!envelope.success) return new ApiError(response.status, "internal", "error.internal");
  const { code, messageKey, fields } = envelope.data.error;
  return new ApiError(response.status, code, messageKey, fields);
}

export async function apiRequest(path: string, request: ApiRequest = {}): Promise<unknown> {
  const { method = "GET", signal } = request;
  let response: Response;
  try {
    response = await fetch(path, { method, credentials: "same-origin", ...sendOf(request), ...(signal === undefined ? {} : { signal }) });
  } catch (error) {
    if (signal?.aborted === true) throw error;
    throw new ApiError(null, "network", "error.network");
  }
  if (!response.ok) throw await errorOf(response);
  return response.json() as Promise<unknown>;
}

export const isUnauthorized = (error: unknown): boolean => error instanceof ApiError && error.status === 401;
