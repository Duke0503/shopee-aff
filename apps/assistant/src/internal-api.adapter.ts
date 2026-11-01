/**
 * The assistant's only way to the server (AD-15, AD-18): the internal listener on loopback, every
 * call with `X-Assistant-Token`. The base URL must be `http://127.0.0.1:<port>`, so a mistyped
 * setting can never send the token anywhere else. `fetch` is injected; tests pass a fake one. An
 * error names the path and the status, never the token or a body.
 */
import { ASSISTANT_HEARTBEAT_PATH, ASSISTANT_TOKEN_HEADER, assistantHeartbeatReceivedSchema, assistantHeartbeatSchema, type AssistantHeartbeat, type AssistantHeartbeatReceived } from "@cashback/contracts";

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;

export const LOOPBACK_BASE_URL = /^http:\/\/127\.0\.0\.1:(\d{1,5})$/;
const REQUEST_TIMEOUT_MS = 10_000;

export class InternalApiError extends Error {
  constructor(
    readonly path: string,
    readonly status: number | null,
  ) {
    super(`internal api ${path} failed${status === null ? "" : ` with ${status}`}`);
    this.name = "InternalApiError";
  }
}

export interface InternalApi {
  heartbeat(beat: AssistantHeartbeat, signal?: AbortSignal): Promise<AssistantHeartbeatReceived>;
}

export interface InternalApiOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly fetch: FetchLike;
}

export function isLoopbackBaseUrl(url: string): boolean {
  const port = LOOPBACK_BASE_URL.exec(url)?.[1];
  return port !== undefined && Number(port) >= 1 && Number(port) <= 65_535;
}

export function internalApi(options: InternalApiOptions): InternalApi {
  if (!isLoopbackBaseUrl(options.baseUrl)) throw new RangeError("the internal api base url must be http://127.0.0.1:<port>");
  const post = async (path: string, body: unknown, signal?: AbortSignal): Promise<unknown> => {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await options
      .fetch(`${options.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", [ASSISTANT_TOKEN_HEADER]: options.token },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
      .catch(() => {
        throw new InternalApiError(path, null);
      });
    if (response.status < 200 || response.status > 299) throw new InternalApiError(path, response.status);
    return response.json();
  };
  return {
    heartbeat: async (beat, signal) => assistantHeartbeatReceivedSchema.parse(await post(ASSISTANT_HEARTBEAT_PATH, assistantHeartbeatSchema.parse(beat), signal)),
  };
}
