/**
 * The real personal Zalo account (AD-15, D9), through zca-js 2.2.0, the exact version the live
 * assistant runs, used the way the live assistant uses it: `new Zalo({ logging: false })`,
 * `login(credentials)` with the session file its `login.js` wrote (cookie, imei, userAgent), the
 * websocket listener started with `retryOnClose`, and `sendMessage` with mentions in groups and
 * the text styles (bold) the live bot sent, in both chats (`{ msg, mentions, styles }`). Reusing
 * that file at cutover keeps the account, so every customer keeps the Zalo id their customer id is
 * (no merge). One account carries one session: the live assistant must be stopped first.
 *
 * Only main.ts opens it, only with `ZALO_MODE=account`, and zca-js is loaded only then, so the fake
 * and the relay never load it; tests replace the module with a fake. The session file is read and
 * handed to zca-js only: no error built here carries its content, and zca-js's own logging is off.
 *
 * The listener (reconnects, a session taken by another login, friend requests and group joins)
 * is zca-connection.ts. An incoming friend request is accepted only by `acceptFriend`, which the
 * assistant calls through the pacer after its own checks (friend-accept.ts).
 *
 * The session is wrapped by `guardTargets` here as well as in zalo-session.ts, so this adapter
 * itself refuses any group outside `ZALO_GROUP_IDS`.
 */
import { readFile } from "node:fs/promises";
import type { API, Credentials, Style as ZcaStyle, ThreadType } from "zca-js";
import { z } from "zod";

import { guardTargets } from "./zalo-target.guard";
import { nonBlank, watchConnection, type ConnectionOptions } from "./zca-connection";
import type { ChatTarget, IncomingMessage, MessageHandler, SessionEventHandler, ZaloSession } from "./zalo.port";

/** zca-js ThreadType values, typed against the library's enum so a change in it fails typecheck. */
const THREAD: { readonly User: ThreadType.User; readonly Group: ThreadType.Group } = {
  User: 0,
  Group: 1,
};

/** zca-js FriendRecommendationsType.ReceivedFriendRequest: a request someone sent this account. */
const RECEIVED_FRIEND_REQUEST = 2;

/** Link cards: a link shared from the Shopee or TikTok app arrives as one, not as text. */
const LINK_MESSAGE_TYPES = new Set(["chat.recommended", "chat.link"]);

export class ZaloLoginError extends Error {
  constructor(reason: string) {
    super(`zalo login failed: ${reason}`);
    this.name = "ZaloLoginError";
  }
}

/** The part of a zca-js message the assistant reads; a real `Message` fits it. */
export interface ZcaIncoming {
  readonly type: number;
  readonly threadId: string;
  readonly isSelf?: boolean;
  readonly data: {
    readonly uidFrom?: unknown;
    readonly dName?: unknown;
    readonly content?: unknown;
    readonly msgType?: unknown;
    readonly quote?: unknown;
  };
}


function paramsLink(params: unknown): string | null {
  if (typeof params === "object" && params !== null)
    return nonBlank((params as { href?: unknown }).href) ?? nonBlank((params as { url?: unknown }).url);
  if (typeof params !== "string") return null;
  try {
    return paramsLink(JSON.parse(params));
  } catch {
    return null;
  }
}

/**
 * The text of a message: a text message as it is; a link card as its link first, then its title
 * and description, so message-parse.ts finds the link; null for photos, stickers, files and the rest.
 */
export function textOf(data: ZcaIncoming["data"]): string | null {
  if (typeof data.content === "string") return nonBlank(data.content);
  if (
    typeof data.content !== "object" ||
    data.content === null ||
    typeof data.msgType !== "string" ||
    !LINK_MESSAGE_TYPES.has(data.msgType)
  )
    return null;
  const card = data.content as {
    href?: unknown;
    url?: unknown;
    link?: unknown;
    params?: unknown;
    title?: unknown;
    description?: unknown;
  };
  const link = nonBlank(card.href) ?? nonBlank(card.url) ?? nonBlank(card.link) ?? paramsLink(card.params);
  const parts = [link, nonBlank(card.title), nonBlank(card.description)].filter(
    (part): part is string => part !== null,
  );
  return parts.length === 0 ? null : parts.join("\n");
}

/** A zca-js message as the assistant reads it; a message with a `quote` is a reply. Own messages are null. */
export const incomingOf = (message: ZcaIncoming): IncomingMessage | null => {
  const senderId = message.data.uidFrom;
  const text = textOf(message.data);
  if (message.isSelf === true || typeof senderId !== "string" || senderId === "" || text === null)
    return null;
  const chat: ChatTarget =
    message.type === THREAD.Group
      ? { kind: "group", groupId: String(message.threadId) }
      : { kind: "private", userId: String(message.threadId || senderId) };
  const quoted = typeof message.data.quote === "object" && message.data.quote !== null;
  return {
    chat,
    senderId,
    senderName: nonBlank(message.data.dName),
    text,
    ...(quoted ? { quoted } : {}),
  };
};

const credentialsSchema = z.looseObject({
  imei: z.string().min(1),
  userAgent: z.string().min(1),
  cookie: z.union([
    z.array(z.looseObject({})).min(1),
    z.looseObject({ url: z.string(), cookies: z.array(z.looseObject({})).min(1) }),
  ]),
});

/** Reads the session file; an error names the keys at fault, never a value or a line of the file. */
export async function readCredentials(path: string): Promise<Credentials> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new ZaloLoginError(
      `cannot read ZALO_CREDENTIALS_PATH (${(error as NodeJS.ErrnoException).code ?? "unknown"})`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ZaloLoginError("ZALO_CREDENTIALS_PATH is not JSON");
  }
  const parsed = credentialsSchema.safeParse(json);
  if (!parsed.success)
    throw new ZaloLoginError(
      `ZALO_CREDENTIALS_PATH lacks ${[...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "content")))].join(", ")}`,
    );
  return parsed.data as unknown as Credentials;
}

type ZcaApi = Pick<
  API,
  | "sendMessage"
  | "sendFriendRequest"
  | "acceptFriendRequest"
  | "getFriendRequestStatus"
  | "getOwnId"
  | "getContext"
  | "getFriendRecommendations"
> & {
  readonly listener: Pick<API["listener"], "on" | "start" | "stop">;
};

export type ZcaSessionOptions = ConnectionOptions;

async function login(credentials: Credentials): Promise<ZcaApi> {
  const { Zalo } = await import("zca-js");
  try {
    return await new Zalo({ logging: false, selfListen: false, checkUpdate: false }).login(
      credentials,
    );
  } catch (error) {
    throw new ZaloLoginError(
      `the session was refused (${error instanceof Error ? error.name : "unknown"}); log in again with the live assistant's login.js`,
    );
  }
}

/** Friend requests on the account; an incoming one is only ever accepted through friend-accept.ts. */
function friendMethods(api: ZcaApi, report: SessionEventHandler): Pick<ZaloSession, "addFriend" | "acceptFriend" | "pendingFriendRequests"> {
  return {
    addFriend: async (userId, greeting) => {
      // As the live friends.js: a friend or someone already asked is left alone. Someone who asked
      // us is handed to the acceptance path (with the server's check), never accepted here.
      const status = await api.getFriendRequestStatus(userId);
      if (status.is_friend > 0 || status.is_requesting > 0) return;
      if (status.is_requested > 0) return void report({ kind: "friend_request", userId });
      await api.sendFriendRequest(greeting, userId);
    },
    acceptFriend: async (userId) => {
      await api.acceptFriendRequest(userId);
    },
    pendingFriendRequests: async () => {
      const { recommItems } = await api.getFriendRecommendations();
      return (recommItems ?? []).flatMap((item) => {
        const userId = item.dataInfo?.recommType === RECEIVED_FRIEND_REQUEST ? nonBlank(item.dataInfo.userId) : null;
        return userId === null ? [] : [userId];
      });
    },
  };
}

export async function openZcaSession(
  credentialsPath: string,
  allowedGroupIds: readonly string[],
  onError: (error: unknown) => void,
  options: ZcaSessionOptions = {},
): Promise<ZaloSession> {
  const api = await login(await readCredentials(credentialsPath));
  let handler: MessageHandler | null = null;
  let events: SessionEventHandler | null = null;
  const connection = watchConnection(
    api,
    (raw: ZcaIncoming) => {
      const message = incomingOf(raw);
      if (message !== null && handler !== null) handler(message).catch(onError);
    },
    (event) => events?.(event),
    onError,
    options,
  );

  const session: ZaloSession = {
    mode: "account",
    connected: connection.open,
    conflicted: connection.conflicted,
    accountId: () => {
      const own = String(api.getOwnId());
      return /^[A-Za-z0-9]{1,40}$/.test(own) ? own : null;
    },
    onMessage: (next) => {
      handler = next;
    },
    sendText: async (target, text, mentions, styles) => {
      const styled = styles === undefined || styles.length === 0 ? {} : { styles: styles.map((s) => ({ start: s.start, len: s.len, st: s.st as ZcaStyle["st"] })) };
      if (target.kind === "private")
        return void (await api.sendMessage({ msg: text, ...styled }, target.userId, THREAD.User));
      const tags = (mentions ?? []).map((m) => ({ uid: m.userId, pos: m.pos, len: m.len }));
      await api.sendMessage(
        { msg: text, ...(tags.length === 0 ? {} : { mentions: tags }), ...styled },
        target.groupId,
        THREAD.Group,
      );
    },
    ...friendMethods(api, (event) => events?.(event)),
    onEvent: (next) => {
      events = next;
    },
    stop: async () => {
      connection.stop();
    },
  };
  return guardTargets(session, allowedGroupIds);
}
