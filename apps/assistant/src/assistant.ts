/**
 * The running assistant (AD-15): one Zalo session behind the target guard, one pacer for every
 * send, the friend-request limit, and the heartbeat loop. It holds no database and serves no
 * listener; the server is reached only through the internal api. An incoming private message
 * records that the person wrote first; every message is then answered by `answerMessage`
 * (registration and link replies, Stories 6.2 and 6.3), its sends in the pacer's turn. The
 * notification loop (Story 6.4) pulls the outbox one row at a time through the same pacer; it
 * does not run on the send-only relay, which writes to the Dev group only and has no private chat.
 */
import type { AssistantHeartbeat } from "@cashback/contracts";
import type { Clock } from "@cashback/core";

import { chatReplier, type ChatSend, type ChatSendWhenDue, type Tag } from "./chat-reply";
import { runHeartbeat } from "./heartbeat.job";
import { friendRequestLimiter, requestFriend, type FriendRequestOutcome, type FriendStateStore } from "./friend-request";
import type { InternalApi } from "./internal-api.adapter";
import { messageText } from "./messages";
import { runNotifications } from "./notification.job";
import { createPacer, type HumanDelay, type Pacer, type Sleep } from "./pacer";
import { memorySentNotifications, type SentNotifications } from "./sent-notifications-file.adapter";
import { guardTargets } from "./zalo-target.guard";
import type { ChatTarget, ZaloSession } from "./zalo.port";

export interface AssistantDeps {
  readonly zalo: ZaloSession;
  readonly api: InternalApi;
  readonly clock: Clock;
  readonly sleep: Sleep;
  readonly sendDelay: HumanDelay;
  readonly zaloGroupIds: readonly string[];
  readonly friendRequestsPerDay: number;
  /** Where the day's friend-request count survives a restart; in memory when left out. */
  readonly friendState?: FriendStateStore;
  readonly onError: (event: string, error: unknown) => void;
  readonly random?: () => number;
  readonly heartbeatIntervalMs?: number;
  /** How long a link reply waits on the server (chat-reply.ts); tests shorten it. */
  readonly replyWaitMs?: number;
  /** The keys of the notifications sent, surviving a restart; in memory when left out. */
  readonly sentNotifications?: SentNotifications;
  /** The wait before asking again when no notification is due. */
  readonly notificationIdleMs?: number;
}

export interface RunningAssistant {
  readonly pacer: Pacer;
  /** Sends one message by key, in the pacer's turn; a group message may tag a person. */
  readonly send: ChatSend;
  requestFriend(userId: string): Promise<FriendRequestOutcome>;
  stop(): Promise<void>;
}

export function startAssistant(deps: AssistantDeps): RunningAssistant {
  const zalo = guardTargets(deps.zalo, deps.zaloGroupIds);
  const pacer = createPacer({ clock: deps.clock, sleep: deps.sleep, delay: deps.sendDelay, ...(deps.random ? { random: deps.random } : {}) });
  const limiter = friendRequestLimiter(deps.clock, deps.friendRequestsPerDay, deps.friendState);
  const stopping = new AbortController();
  const startedAt = deps.clock.now();

  const write = (target: ChatTarget, text: string, tag?: Tag | null): Promise<void> => {
    if (target.kind !== "group" || !tag) return zalo.sendText(target, text);
    // A group reply opens with "@Name" on its own line, tagged as a mention of the sender (as live).
    const mark = `@${tag.name}`;
    return zalo.sendText(target, `${mark}\n${text}`, [{ userId: tag.userId, pos: 0, len: mark.length }]);
  };
  const send: ChatSend = (target, key, values, tag) => {
    const text = messageText(key, values);
    return pacer.send(() => write(target, text, tag));
  };
  const sendWhenDue: ChatSendWhenDue = (target, decide, tag) =>
    pacer.send(async () => {
      const message = await decide();
      if (message !== null) await write(target, messageText(message.key, message.values), tag);
    });
  const answer = chatReplier({ api: deps.api, clock: deps.clock, sleep: deps.sleep, send, sendWhenDue, ...(deps.replyWaitMs === undefined ? {} : { replyWaitMs: deps.replyWaitMs }) });
  zalo.onMessage(async (message) => {
    if (message.chat.kind === "private") limiter.noteWroteFirst(message.senderId);
    await answer(message).catch((error: unknown) => deps.onError("assistant.message.failed", error));
  });

  const beat = (): AssistantHeartbeat => ({ zalo: zalo.mode, session: zalo.connected() ? "connected" : "disconnected", startedAt, queuedSends: pacer.queued() });
  const heartbeat = runHeartbeat({
    api: deps.api,
    sleep: deps.sleep,
    beat,
    onFailure: (error) => deps.onError("assistant.heartbeat.failed", error),
    signal: stopping.signal,
    ...(deps.heartbeatIntervalMs ? { intervalMs: deps.heartbeatIntervalMs } : {}),
  });
  const notifications =
    zalo.mode === "relay"
      ? Promise.resolve()
      : runNotifications({
          api: deps.api,
          send,
          sent: deps.sentNotifications ?? memorySentNotifications(),
          connected: () => zalo.connected(),
          onError: deps.onError,
          sleep: deps.sleep,
          signal: stopping.signal,
          ...(deps.notificationIdleMs === undefined ? {} : { idleMs: deps.notificationIdleMs }),
        }).catch((error: unknown) => deps.onError("assistant.notifications.stopped", error));
  const friends = { limiter, pacer, zalo, clock: deps.clock, sleep: deps.sleep, greeting: messageText("friend_request_greeting"), signal: stopping.signal };

  return {
    pacer,
    send,
    requestFriend: (userId) => requestFriend(friends, userId),
    stop: async () => {
      stopping.abort();
      await heartbeat;
      await notifications;
      await zalo.stop();
    },
  };
}
