/**
 * The assistant's only way to the server (AD-15, AD-18): the internal listener on loopback, every
 * call with `X-Assistant-Token`. The base URL must be `http://127.0.0.1:<port>`, so a mistyped
 * setting can never send the token anywhere else. `fetch` is injected; tests pass a fake one. An
 * error names the path, the status and the server's message key, never the token or a body.
 */
import {
  ASSISTANT_HEARTBEAT_PATH,
  ASSISTANT_LINK_REPLY_PATH,
  ASSISTANT_LINK_REQUEST_PATH,
  ASSISTANT_REGISTRATION_PATH,
  ASSISTANT_TOKEN_HEADER,
  assistantHeartbeatReceivedSchema,
  assistantHeartbeatSchema,
  assistantLinkAnswerSchema,
  assistantLinkReplyQuerySchema,
  assistantLinkReplySchema,
  assistantLinkRequestSchema,
  assistantRegisteredSchema,
  assistantRegistrationSchema,
  errorEnvelopeSchema,
  type AssistantHeartbeat,
  type AssistantHeartbeatReceived,
  type AssistantLinkAnswer,
  type AssistantLinkReply,
  type AssistantLinkReplyQuery,
  type AssistantLinkRequest,
  type AssistantRegistered,
  type AssistantRegistration,
} from "@cashback/contracts";

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;

export const LOOPBACK_BASE_URL = /^http:\/\/127\.0\.0\.1:(\d{1,5})$/;
const REQUEST_TIMEOUT_MS = 10_000;

export class InternalApiError extends Error {
  constructor(
    readonly path: string,
    readonly status: number | null,
    /** The error envelope's message key (`error.link.network_unsupported`), when the server sent one. */
    readonly messageKey: string | null = null,
  ) {
    super(`internal api ${path} failed${status === null ? "" : ` with ${status}`}${messageKey === null ? "" : ` (${messageKey})`}`);
    this.name = "InternalApiError";
  }
}

export interface InternalApi {
  heartbeat(beat: AssistantHeartbeat, signal?: AbortSignal): Promise<AssistantHeartbeatReceived>;
  /** A private message: the sender registered, or found again (Story 6.2). */
  register(person: AssistantRegistration): Promise<AssistantRegistered>;
  /** A pasted link queued for its sender, or refused with its reason; the sender registered on the way when due (Stories 6.2, 6.3). */
  requestLink(request: AssistantLinkRequest): Promise<AssistantLinkAnswer>;
  /** What the reply to one of the sender's requests says now. */
  linkReply(query: AssistantLinkReplyQuery): Promise<AssistantLinkReply>;
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

const messageKeyOf = async (response: { json(): Promise<unknown> }): Promise<string | null> => {
  const body = errorEnvelopeSchema.safeParse(await response.json().catch(() => null));
  return body.success ? body.data.error.messageKey : null;
};

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
    if (response.status < 200 || response.status > 299) throw new InternalApiError(path, response.status, await messageKeyOf(response));
    return response.json();
  };
  return {
    heartbeat: async (beat, signal) => assistantHeartbeatReceivedSchema.parse(await post(ASSISTANT_HEARTBEAT_PATH, assistantHeartbeatSchema.parse(beat), signal)),
    register: async (person) => assistantRegisteredSchema.parse(await post(ASSISTANT_REGISTRATION_PATH, assistantRegistrationSchema.parse(person))),
    requestLink: async (request) => assistantLinkAnswerSchema.parse(await post(ASSISTANT_LINK_REQUEST_PATH, assistantLinkRequestSchema.parse(request))),
    linkReply: async (query) => assistantLinkReplySchema.parse(await post(ASSISTANT_LINK_REPLY_PATH, assistantLinkReplyQuerySchema.parse(query))),
  };
}
