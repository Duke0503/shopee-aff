/**
 * A fake internal listener for the chat tests: a `fetch` that answers the assistant's routes from
 * handlers the test sets, and records every call. Nothing here opens a connection.
 */
import {
  ASSISTANT_HEARTBEAT_PATH,
  ASSISTANT_LINK_CLAIM_PATH,
  ASSISTANT_LINK_CONFIRM_PATH,
  ASSISTANT_LINK_RELEASE_PATH,
  ASSISTANT_LINK_REPLY_PATH,
  ASSISTANT_LINK_REQUEST_PATH,
  ASSISTANT_REGISTRATION_PATH,
  NOTIFICATION_ACK_ROUTE,
  NOTIFICATION_NEXT_PATH,
  type AssistantLinkReply,
  type LinkRefusal,
} from "@cashback/contracts";
import { systemClock } from "@cashback/core";

import type { FetchLike } from "../src/internal-api.adapter";

export const BASE = "http://127.0.0.1:9081";
export const TOKEN = "a".repeat(40);

export interface Answer {
  readonly status: number;
  readonly body: unknown;
}

export type Handler = (body: Record<string, unknown>) => Answer;

export interface FakeServer {
  readonly fetch: FetchLike;
  readonly calls: { path: string; body: Record<string, unknown> }[];
  readonly routes: Record<string, Handler>;
  callsTo(path: string): Record<string, unknown>[];
}

export const ok = (body: unknown): Answer => ({ status: 200, body });
/** A link the server refused, with its reason; `registered` as the route says it. */
export const refused = (reason: LinkRefusal, registered = false): Answer => ok({ outcome: "refused", reason, customerId: registered ? "70001" : null, customerCode: registered ? "DP00001" : null, registered });

/** A link reply as the server would send it; `over` changes what the test needs. */
export function replyOf(requestId: string, over: Partial<AssistantLinkReply> = {}): AssistantLinkReply {
  return { requestId, status: "QUEUED", shareUrl: null, factsSettled: false, network: "shopee", perShop: false, product: { name: null, price: null }, estimate: null, ...over };
}

export function fakeServer(): FakeServer {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const known = new Map<string, string>();
  const register = (body: Record<string, unknown>): { id: string; code: string; created: boolean } => {
    const id = String(body["zaloUserId"]);
    const created = !known.has(id);
    if (created) known.set(id, `DP${String(known.size + 1).padStart(5, "0")}`);
    return { id, code: known.get(id) ?? "", created };
  };
  const routes: Record<string, Handler> = {
    [ASSISTANT_HEARTBEAT_PATH]: () => ok({ receivedAt: systemClock.now() }),
    [ASSISTANT_REGISTRATION_PATH]: (body) => {
      const { id, code, created } = register(body);
      return ok({ customerId: id, customerCode: code, created });
    },
    // A private message registers its sender; in the group the fake treats the member as known.
    [ASSISTANT_LINK_REQUEST_PATH]: (body) => {
      const { id, code, created } = body["chat"] === "private" ? register(body) : { id: String(body["zaloUserId"]), code: "DP00009", created: false };
      return ok({ outcome: "queued", customerId: id, customerCode: code, registered: created, requestId: "26110100001", reused: false });
    },
    [ASSISTANT_LINK_REPLY_PATH]: (body) => ok(replyOf(String(body["requestId"]))),
    // Story 6.5: the reply claims its link; nothing is due in the outbox unless a test says so.
    [ASSISTANT_LINK_CLAIM_PATH]: () => ok({ claim: "claimed" }),
    [ASSISTANT_LINK_RELEASE_PATH]: () => ok({ released: true }),
    [ASSISTANT_LINK_CONFIRM_PATH]: () => ok({ confirmed: true }),
    [NOTIFICATION_NEXT_PATH]: () => ok({ notification: null }),
    [NOTIFICATION_ACK_ROUTE]: (body) => ok({ id: body["id"], outcome: "sent" }),
  };
  const fetch: FetchLike = async (url, init) => {
    const path = url.slice(BASE.length);
    const body = JSON.parse(init.body ?? "{}") as Record<string, unknown>;
    calls.push({ path, body });
    // An ack names its notification in the path; its handler gets the id in the body.
    const ack = /^\/internal\/notifications\/(\d+)\/ack$/.exec(path);
    if (ack) body["id"] = Number(ack[1]);
    const handler = routes[ack ? NOTIFICATION_ACK_ROUTE : path];
    const answer = handler === undefined ? { status: 404, body: { error: { code: "not_found", messageKey: "error.not_found" } } } : handler(body);
    return { status: answer.status, json: async () => answer.body };
  };
  return { fetch, calls, routes, callsTo: (path) => calls.filter((c) => c.path === path).map((c) => c.body) };
}
