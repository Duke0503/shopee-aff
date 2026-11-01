/**
 * The real personal Zalo account (AD-15, D9), through zca-js as the live assistant uses it. Only
 * main.ts constructs it, only with `ZALO_MODE=account`; no test ever does, so no test can reach a
 * real account. zca-js is not a dependency of the workspace yet: it is loaded by name at start and
 * a missing package stops the start with a clear error. Adding it (exact version) and the first
 * run against the Dev group are the owner's call.
 *
 * The session is wrapped by `guardTargets` here as well as in main.ts, so this adapter itself
 * refuses any group outside `ZALO_GROUP_IDS`.
 */
import { readFile } from "node:fs/promises";

import { guardTargets } from "./zalo-target.guard";
import type { ChatTarget, IncomingMessage, MessageHandler, ZaloSession } from "./zalo.port";

/** zca-js ThreadType values. */
const THREAD_USER = 0;
const THREAD_GROUP = 1;

/** The part of the zca-js api this adapter uses. */
interface ZcaApi {
  sendMessage(message: { msg: string; mentions?: { uid: string; pos: number; len: number }[] }, threadId: string, threadType: number): Promise<unknown>;
  sendFriendRequest(message: string, userId: string): Promise<unknown>;
  getOwnId(): string;
  listener: {
    on(event: "message", handler: (message: { type: number; threadId: string; data: { uidFrom?: string; dName?: unknown; content?: unknown; quote?: unknown } }) => void): void;
    on(event: "connected" | "closed", handler: () => void): void;
    start(options?: { retryOnClose?: boolean }): void;
    stop(): void;
  };
}

interface ZcaModule {
  Zalo: new (options: { logging: boolean; selfListen: boolean }) => { login(credentials: unknown): Promise<ZcaApi> };
}

const ZCA_PACKAGE = "zca-js";

async function loadZca(): Promise<ZcaModule> {
  try {
    return (await import(ZCA_PACKAGE)) as ZcaModule;
  } catch {
    throw new Error("ZALO_MODE=account needs the zca-js package, which is not installed in this workspace");
  }
}

/** A zca-js message as the assistant reads it; a message with a `quote` is a reply. */
export const incomingOf = (message: { type: number; threadId: string; data: { uidFrom?: string; dName?: unknown; content?: unknown; quote?: unknown } }): IncomingMessage | null => {
  const senderId = message.data.uidFrom;
  if (typeof senderId !== "string" || typeof message.data.content !== "string") return null;
  const chat: ChatTarget = message.type === THREAD_GROUP ? { kind: "group", groupId: String(message.threadId) } : { kind: "private", userId: senderId };
  const quoted = typeof message.data.quote === "object" && message.data.quote !== null;
  return { chat, senderId, senderName: typeof message.data.dName === "string" ? message.data.dName : null, text: message.data.content, ...(quoted ? { quoted } : {}) };
};

export async function openZcaSession(credentialsPath: string, allowedGroupIds: readonly string[], onError: (error: unknown) => void): Promise<ZaloSession> {
  const { Zalo } = await loadZca();
  const credentials: unknown = JSON.parse(await readFile(credentialsPath, "utf8"));
  const api = await new Zalo({ logging: false, selfListen: false }).login(credentials);
  let handler: MessageHandler | null = null;
  let open = false;
  api.listener.on("connected", () => (open = true));
  api.listener.on("closed", () => (open = false));
  api.listener.on("message", (raw) => {
    const message = incomingOf(raw);
    if (message !== null && handler !== null) handler(message).catch(onError);
  });
  api.listener.start({ retryOnClose: true });
  const session: ZaloSession = {
    mode: "account",
    connected: () => open,
    accountId: () => {
      const own = String(api.getOwnId());
      return /^[A-Za-z0-9]{1,40}$/.test(own) ? own : null;
    },
    onMessage: (next) => {
      handler = next;
    },
    sendText: async (target, text, mentions) => {
      if (target.kind === "private") return void (await api.sendMessage({ msg: text }, target.userId, THREAD_USER));
      const tags = (mentions ?? []).map((m) => ({ uid: m.userId, pos: m.pos, len: m.len }));
      await api.sendMessage(tags.length === 0 ? { msg: text } : { msg: text, mentions: tags }, target.groupId, THREAD_GROUP);
    },
    addFriend: async (userId, greeting) => {
      await api.sendFriendRequest(greeting, userId);
    },
    stop: async () => {
      api.listener.stop();
      open = false;
    },
  };
  return guardTargets(session, allowedGroupIds);
}
