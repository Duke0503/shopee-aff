/**
 * The running assistant (AD-15): one Zalo session behind the target guard, one pacer for every
 * send, the friend-request limit, and the heartbeat loop. It holds no database and serves no
 * listener; the server is reached only through the internal api. An incoming private message
 * records that the person wrote first; every message is then answered by `answerMessage`
 * (registration and link replies, Stories 6.2 and 6.3), its sends in the pacer's turn. The
 * notification loop (Story 6.4) pulls the outbox one row at a time through the same pacer; it
 * does not run on the send-only relay, which writes to the Dev group only and has no private chat.
 * A lost Zalo session (Story 6.11) is seen through the session itself: the beat reports it, the
 * loss is logged once, and the notification loop pulls nothing until the session is back, so
 * waiting notifications stay on the server. A friend request someone sent is accepted, people who
 * join a welcome group are welcomed, and a session another login took is reported at once
 * (session-events.ts).
 */
import type { AssistantHeartbeat } from "@cashback/contracts";
import type { Clock } from "@cashback/core";

import { chatReplier, type ChatSend, type ChatSendWhenDue, type Tag } from "./chat-reply";
import { runHeartbeat, sessionBeat } from "./heartbeat.job";
import { friendAccepter } from "./friend-accept";
import { friendRequestLimiter, requestFriend, type FriendRequestLimiter, type FriendRequestOutcome, type FriendStateStore } from "./friend-request";
import { groupWelcomer, memoryWelcomeStore, type WelcomeStore } from "./group-welcome";
import type { InternalApi } from "./internal-api.adapter";
import { messageText, styledMessage } from "./messages";
import { runNotifications } from "./notification.job";
import { createPacer, type HumanDelay, type Pacer, type Sleep } from "./pacer";
import { memorySentNotifications, type SentNotifications } from "./sent-notifications-file.adapter";
import { rescanFriendRequests, sessionEventHandler } from "./session-events";
import { shiftStyles, type StyledText } from "./styled-text";
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
  /** The groups whose new members are welcomed (assistant.config.ts); none when left out. */
  readonly welcomeGroupIds?: readonly string[];
  /** Who was welcomed, surviving a restart; in memory when left out. */
  readonly welcomeState?: WelcomeStore;
}

export interface RunningAssistant {
  readonly pacer: Pacer;
  /** Sends one message by key, in the pacer's turn; a group message may tag a person. */
  readonly send: ChatSend;
  requestFriend(userId: string): Promise<FriendRequestOutcome>;
  stop(): Promise<void>;
}

/** Friend requests, group joins and a session conflict (session-events.ts). */
function listenToSessionEvents(deps: AssistantDeps, run: { zalo: ZaloSession; pacer: Pacer; limiter: FriendRequestLimiter; beat: () => AssistantHeartbeat; signal: AbortSignal }): void {
  const { zalo, pacer } = run;
  const friends = friendAccepter({ limiter: run.limiter, pacer, zalo, api: deps.api, clock: deps.clock, sleep: deps.sleep, random: deps.random ?? Math.random, signal: run.signal });
  const welcome = groupWelcomer({ welcomeGroupIds: deps.welcomeGroupIds ?? [], store: deps.welcomeState ?? memoryWelcomeStore(), random: deps.random ?? Math.random, send: (target, message, mentions) => pacer.send(() => zalo.sendText(target, message.text, mentions, message.styles)) });
  zalo.onEvent(sessionEventHandler({ friends, welcome, api: deps.api, beat: run.beat, onError: deps.onError }));
  rescanFriendRequests(friends, deps.onError);
}

export function startAssistant(deps: AssistantDeps): RunningAssistant {
  const zalo = guardTargets(deps.zalo, deps.zaloGroupIds);
  const pacer = createPacer({ clock: deps.clock, sleep: deps.sleep, delay: deps.sendDelay, ...(deps.random ? { random: deps.random } : {}) });
  const limiter = friendRequestLimiter(deps.clock, deps.friendRequestsPerDay, deps.friendState);
  const stopping = new AbortController();
  const startedAt = deps.clock.now();
  const write = (target: ChatTarget, message: StyledText, tag?: Tag | null): Promise<void> => {
    if (target.kind !== "group" || !tag) return zalo.sendText(target, message.text, undefined, message.styles);
    // A group reply opens with "@Name" on its own line, tagged as a mention of the sender (as live);
    // the message's bold runs move down by that line.
    const mark = `@${tag.name}`;
    return zalo.sendText(target, `${mark}\n${message.text}`, [{ userId: tag.userId, pos: 0, len: mark.length }], shiftStyles(message.styles, mark.length + 1));
  };
  const send: ChatSend = (target, key, values, tag) => {
    const message = styledMessage(key, values);
    return pacer.send(() => write(target, message, tag));
  };
  const sendWhenDue: ChatSendWhenDue = (target, decide, tag) =>
    pacer.send(async () => {
      const message = await decide();
      if (message !== null) await write(target, styledMessage(message.key, message.values), tag);
    });
  const answer = chatReplier({ api: deps.api, clock: deps.clock, sleep: deps.sleep, send, sendWhenDue, ...(deps.replyWaitMs === undefined ? {} : { replyWaitMs: deps.replyWaitMs }) });
  zalo.onMessage(async (message) => {
    if (message.chat.kind === "private") limiter.noteWroteFirst(message.senderId);
    await answer(message).catch((error: unknown) => deps.onError("assistant.message.failed", error));
  });

  const beat = sessionBeat(zalo, startedAt, () => pacer.queued(), () => deps.onError("assistant.zalo.session_lost", new Error("zalo session closed")));
  listenToSessionEvents(deps, { zalo, pacer, limiter, beat, signal: stopping.signal });
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

  return {
    pacer,
    send,
    requestFriend: (userId) => requestFriend({ limiter, pacer, zalo, clock: deps.clock, sleep: deps.sleep, greeting: messageText("friend_request_greeting"), signal: stopping.signal }, userId),
    stop: async () => {
      stopping.abort();
      await heartbeat;
      await notifications;
      await zalo.stop();
    },
  };
}
