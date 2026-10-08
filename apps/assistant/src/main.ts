import { createApiClient } from "@mmo/contracts";

import { readConfig, type AssistantConfig } from "./config";
import type { HandlerDeps } from "./handler";
import { loadMessages } from "./messages";
import { createWorker, type Worker } from "./worker";
import { createZcaClient } from "./zca-adapter";
import type { ZaloClient } from "./zalo-client";

/**
 * Wire the assistant with any Zalo client. `api` is the server side of the
 * conversation (convert a link, list orders, save bank details); passing it
 * in keeps the whole loop runnable with doubles.
 */
export function buildWorker(
  client: ZaloClient,
  config: AssistantConfig,
  api: HandlerDeps,
): Worker {
  return createWorker({
    client,
    routing: {
      env: config.env,
      mainGroupId: config.mainGroupId,
      listenGroupIds: config.listenGroupIds,
    },
    messages: loadMessages(config.messagesPath),
    api,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    minGapMs: config.minGapMs,
    friendRequests: config.friendRequests,
    ratePercent: config.ratePercent,
    attributionDays: config.attributionDays,
  });
}

/** The server calls the assistant makes, with the assistant's own token. */
export function createServerApi(config: AssistantConfig): HandlerDeps {
  const authorized: typeof fetch = (input, init) =>
    fetch(input, {
      ...init,
      headers: { ...(init?.headers ?? {}), "x-assistant-token": config.assistantToken },
    });
  const api = createApiClient(authorized, config.serverUrl);
  return {
    convert: (url, customerId) => api.convert(url, customerId),
    myOrders: () => api.myOrders(),
    saveBank: async (_customerId, details) => {
      await api.saveBank(details);
    },
  };
}

/**
 * Start the assistant. It cannot start yet on purpose: the Zalo client is the
 * one piece not wired (`createZcaClient`), so this throws a clear message
 * rather than touching an account. Wire that adapter to use this.
 */
export function run(env: NodeJS.ProcessEnv = process.env): Worker {
  const config = readConfig(env);
  const client = createZcaClient({
    cookie: config.zaloCookie,
    serverUrl: config.serverUrl,
    token: config.assistantToken,
  });
  const worker = buildWorker(client, config, createServerApi(config));
  client.onMessage((message) => worker.onMessage(message));
  return worker;
}
