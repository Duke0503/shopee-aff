/**
 * The assistant's only way to the server (AD-15, AD-18): the internal listener on loopback, every
 * call with `X-Assistant-Token`. The base URL must be `http://127.0.0.1:<port>`, so a mistyped
 * setting can never send the token anywhere else. `fetch` is injected; tests pass a fake one. An
 * error names the path, the status and the server's message key, never the token or a body.
 */
import {
  ASSISTANT_COMMAND_PATH,
  ASSISTANT_HEARTBEAT_PATH,
  ASSISTANT_LINK_CLAIM_PATH,
  ASSISTANT_LINK_CONFIRM_PATH,
  ASSISTANT_LINK_RELEASE_PATH,
  ASSISTANT_LINK_REPLY_PATH,
  ASSISTANT_LINK_REQUEST_PATH,
  ASSISTANT_REGISTRATION_PATH,
  ASSISTANT_TOKEN_HEADER,
  assistantCommandAnswerSchema,
  assistantCommandSchema,
  assistantHeartbeatReceivedSchema,
  assistantHeartbeatSchema,
  assistantLinkAnswerSchema,
  assistantLinkClaimedSchema,
  assistantLinkClaimSchema,
  assistantLinkConfirmedSchema,
  assistantLinkReleasedSchema,
  assistantLinkReplyQuerySchema,
  assistantLinkReplySchema,
  assistantLinkRequestSchema,
  assistantRegisteredSchema,
  assistantRegistrationSchema,
  errorEnvelopeSchema,
  NOTIFICATION_NEXT_PATH,
  notificationAckedSchema,
  notificationAckPath,
  notificationAckSchema,
  notificationNextSchema,
  type AssistantCommand,
  type AssistantCommandAnswer,
  type AssistantHeartbeat,
  type AssistantHeartbeatReceived,
  type AssistantLinkAnswer,
  type AssistantLinkClaim,
  type AssistantLinkClaimed,
  type AssistantNotification,
  type AssistantLinkReply,
  type AssistantLinkReplyQuery,
  type AssistantLinkRequest,
  type AssistantRegistered,
  type AssistantRegistration,
  type NotificationAck,
  type NotificationAcked,
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
  /** The chat reply hands the link over now (Story 6.5); `delivered_before` when a notification already did. */
  claimLink(claim: AssistantLinkClaim): Promise<AssistantLinkClaimed>;
  /** The claimed reply could not be sent: the link goes by notification instead. */
  releaseLink(claim: AssistantLinkClaim): Promise<boolean>;
  /** The chat reply was sent: the claimed link is DELIVERED (Story 6.5). */
  confirmLink(claim: AssistantLinkClaim): Promise<boolean>;
  /** A chat command answered with its facts; a private one registers its sender first (Story 6.7). */
  command(command: AssistantCommand): Promise<AssistantCommandAnswer>;
  /** The next due notification, leased to this assistant, or null (Story 6.4). */
  nextNotification(signal?: AbortSignal): Promise<AssistantNotification | null>;
  acknowledgeNotification(id: number, ack: NotificationAck, signal?: AbortSignal): Promise<NotificationAcked>;
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
  const call = async (method: "GET" | "POST", path: string, body: unknown, signal?: AbortSignal): Promise<unknown> => {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const headers: Record<string, string> = { [ASSISTANT_TOKEN_HEADER]: options.token, ...(method === "POST" ? { "content-type": "application/json" } : {}) };
    const response = await options
      .fetch(`${options.baseUrl}${path}`, {
        method,
        headers,
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
      .catch(() => {
        throw new InternalApiError(path, null);
      });
    if (response.status < 200 || response.status > 299) throw new InternalApiError(path, response.status, await messageKeyOf(response));
    return response.json();
  };
  const post = (path: string, body: unknown, signal?: AbortSignal): Promise<unknown> => call("POST", path, body, signal);
  return {
    heartbeat: async (beat, signal) => assistantHeartbeatReceivedSchema.parse(await post(ASSISTANT_HEARTBEAT_PATH, assistantHeartbeatSchema.parse(beat), signal)),
    register: async (person) => assistantRegisteredSchema.parse(await post(ASSISTANT_REGISTRATION_PATH, assistantRegistrationSchema.parse(person))),
    requestLink: async (request) => assistantLinkAnswerSchema.parse(await post(ASSISTANT_LINK_REQUEST_PATH, assistantLinkRequestSchema.parse(request))),
    linkReply: async (query) => assistantLinkReplySchema.parse(await post(ASSISTANT_LINK_REPLY_PATH, assistantLinkReplyQuerySchema.parse(query))),
    claimLink: async (claim) => assistantLinkClaimedSchema.parse(await post(ASSISTANT_LINK_CLAIM_PATH, assistantLinkClaimSchema.parse(claim))),
    releaseLink: async (claim) => assistantLinkReleasedSchema.parse(await post(ASSISTANT_LINK_RELEASE_PATH, assistantLinkClaimSchema.parse(claim))).released,
    confirmLink: async (claim) => assistantLinkConfirmedSchema.parse(await post(ASSISTANT_LINK_CONFIRM_PATH, assistantLinkClaimSchema.parse(claim))).confirmed,
    command: async (command) => assistantCommandAnswerSchema.parse(await post(ASSISTANT_COMMAND_PATH, assistantCommandSchema.parse(command))),
    nextNotification: async (signal) => notificationNextSchema.parse(await call("GET", NOTIFICATION_NEXT_PATH, undefined, signal)).notification,
    acknowledgeNotification: async (id, ack, signal) => notificationAckedSchema.parse(await post(notificationAckPath(id), notificationAckSchema.parse(ack), signal)),
  };
}
