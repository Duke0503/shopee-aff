/**
 * The running assistant (AD-15): one Zalo session behind the target guard, one pacer for every
 * send, the friend-request limit, and the heartbeat loop. It holds no database and serves no
 * listener; the server is reached only through the internal api. An incoming private message
 * records that the person wrote first; every message is then answered by `answerMessage`
 * (registration and link replies, Stories 6.2 and 6.3), its sends in the pacer's turn.
 */
import type { AssistantHeartbeat } from "@cashback/contracts";
import type { Clock } from "@cashback/core";

import { chatReplier, type ChatSend } from "./chat-reply";
import { runHeartbeat } from "./heartbeat.job";
import { friendRequestLimiter, requestFriend, type FriendRequestOutcome, type FriendStateStore } from "./friend-request";
import type { InternalApi } from "./internal-api.adapter";
import { messageText } from "./messages";
import { createPacer, type HumanDelay, type Pacer, type Sleep } from "./pacer";
import { guardTargets } from "./zalo-target.guard";
import type { ZaloSession } from "./zalo.port";

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

  const send: ChatSend = (target, key, values, tag) => {
    const text = messageText(key, values);
    if (target.kind !== "group" || !tag) return pacer.send(() => zalo.sendText(target, text));
    // A group reply opens with "@Name" on its own line, tagged as a mention of the sender (as live).
    const mark = `@${tag.name}`;
    return pacer.send(() => zalo.sendText(target, `${mark}\n${text}`, [{ userId: tag.userId, pos: 0, len: mark.length }]));
  };
  const answer = chatReplier({ api: deps.api, clock: deps.clock, sleep: deps.sleep, send, ...(deps.replyWaitMs === undefined ? {} : { replyWaitMs: deps.replyWaitMs }) });
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
  const friends = { limiter, pacer, zalo, clock: deps.clock, sleep: deps.sleep, greeting: messageText("friend_request_greeting"), signal: stopping.signal };

  return {
    pacer,
    send,
    requestFriend: (userId) => requestFriend(friends, userId),
    stop: async () => {
      stopping.abort();
      await heartbeat;
      await zalo.stop();
    },
  };
}
