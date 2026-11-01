/**
 * The running assistant (AD-15): one Zalo session behind the target guard, one pacer for every
 * send, the friend-request limit, and the heartbeat loop. It holds no database and serves no
 * listener; the server is reached only through the internal api. Replying to what people write
 * (registration, link requests, commands) arrives with Stories 6.2 onward; for now an incoming
 * private message only records that the person wrote first.
 */
import type { AssistantHeartbeat } from "@cashback/contracts";
import type { Clock } from "@cashback/core";

import { runHeartbeat } from "./heartbeat.job";
import { friendRequestLimiter, requestFriend, type FriendRequestOutcome, type FriendStateStore } from "./friend-request";
import type { InternalApi } from "./internal-api.adapter";
import { messageText, type MessageKey } from "./messages";
import { createPacer, type HumanDelay, type Pacer, type Sleep } from "./pacer";
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
}

export interface RunningAssistant {
  readonly pacer: Pacer;
  /** Sends one message by key, in the pacer's turn. */
  send(target: ChatTarget, key: MessageKey, values?: Readonly<Record<string, string | number>>): Promise<void>;
  requestFriend(userId: string): Promise<FriendRequestOutcome>;
  stop(): Promise<void>;
}

export function startAssistant(deps: AssistantDeps): RunningAssistant {
  const zalo = guardTargets(deps.zalo, deps.zaloGroupIds);
  const pacer = createPacer({ clock: deps.clock, sleep: deps.sleep, delay: deps.sendDelay, ...(deps.random ? { random: deps.random } : {}) });
  const limiter = friendRequestLimiter(deps.clock, deps.friendRequestsPerDay, deps.friendState);
  const stopping = new AbortController();
  const startedAt = deps.clock.now();

  zalo.onMessage(async (message) => {
    if (message.chat.kind === "private") limiter.noteWroteFirst(message.senderId);
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
    send: (target, key, values) => pacer.send(() => zalo.sendText(target, messageText(key, values))),
    requestFriend: (userId) => requestFriend(friends, userId),
    stop: async () => {
      stopping.abort();
      await heartbeat;
      await zalo.stop();
    },
  };
}
