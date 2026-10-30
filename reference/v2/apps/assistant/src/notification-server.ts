import { timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import type { ZaloClient } from "./zalo-client";

/**
 * The tiny HTTP server the backend calls when it has news on its own:
 * `/api/notify` for a private message, `/api/broadcast` for the group,
 * `/api/group-info` to read the group. It listens on this machine only and
 * every call must carry `X-Assistant-Token`, compared in constant time — the
 * source address is never proof of who is calling (ADR-16). The assistant
 * refuses to start without the token.
 */
export interface NotificationServerConfig {
  port: number;
  host: string;
  token: string;
  mainGroupId: string;
}

export interface NotifyPayload {
  targetId?: string;
  type?: "user" | "group";
  message?: string;
}

export interface BroadcastPayload {
  group?: string;
  message?: string;
}

export interface NotificationServer {
  port: number;
  close(): Promise<void>;
}

function tokensMatch(expected: string, provided: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  client: ZaloClient,
  config: NotificationServerConfig,
): Promise<void> {
  const header = request.headers["x-assistant-token"];
  const provided = Array.isArray(header) ? header[0] : header;
  if (typeof provided !== "string" || !tokensMatch(config.token, provided)) {
    sendJson(response, 401, { ok: false, error: "bad token" });
    return;
  }

  const path = request.url ?? "";
  if (request.method === "POST" && path === "/api/notify") {
    const payload = parseJson<NotifyPayload>(await readBody(request));
    if (!payload?.targetId || typeof payload.message !== "string") {
      sendJson(response, 400, { ok: false, error: "targetId and message are required" });
      return;
    }
    await client.sendText(payload.targetId, payload.message);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && path === "/api/broadcast") {
    const payload = parseJson<BroadcastPayload>(await readBody(request));
    if (typeof payload?.message !== "string") {
      sendJson(response, 400, { ok: false, error: "message is required" });
      return;
    }
    const group =
      payload.group && payload.group !== "test" ? payload.group : config.mainGroupId;
    await client.sendText(group, payload.message);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && path === "/api/group-info") {
    sendJson(response, 200, { ok: true, groupId: config.mainGroupId });
    return;
  }

  sendJson(response, 404, { ok: false, error: "not found" });
}

export function createNotificationServer(
  client: ZaloClient,
  config: NotificationServerConfig,
): Server {
  if (!config.token) {
    throw new Error("ASSISTANT_TOKEN is required to start the notification server");
  }
  return createServer((request, response) => {
    void handleRequest(request, response, client, config).catch((error: unknown) => {
      sendJson(response, 500, { ok: false, error: String(error) });
    });
  });
}

/** Start listening and resolve once the port is bound. */
export function startNotificationServer(
  client: ZaloClient,
  config: NotificationServerConfig,
): Promise<NotificationServer> {
  const server = createNotificationServer(client, config);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : config.port;
      resolve({
        port,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
