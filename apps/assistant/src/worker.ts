import { decideFriendRequest, type FriendRequestState } from "./friend-requests";
import { handleIncoming, type HandlerDeps } from "./handler";
import type { Messages } from "./messages";
import { GroupPacer } from "./pacer";
import { renderReply } from "./reply-wording";
import { routeOutgoing, type RoutingConfig } from "./routing";
import type { ZaloClient, ZaloIncomingMessage } from "./zalo-client";

export interface FriendRequestLimits {
  minGapMs: number;
  maxPerRun: number;
}

export interface WorkerDeps {
  client: ZaloClient;
  routing: RoutingConfig;
  messages: Messages;
  api: HandlerDeps;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  minGapMs: number;
  friendRequests: FriendRequestLimits;
  ratePercent: string;
  attributionDays: number;
}

export interface Worker {
  onMessage(message: ZaloIncomingMessage): Promise<void>;
  /** Best-effort friend request, subject to the rate limits. */
  maybeAddFriend(userId: string, greeting: string): Promise<boolean>;
}

/**
 * The assistant's loop: one incoming message in, one paced reply out. It owns
 * no transport and no wording — the Zalo client and the message file are
 * passed in, so a dry run costs nothing and touches no live account.
 */
export function createWorker(deps: WorkerDeps): Worker {
  const pacer = new GroupPacer(deps.minGapMs);
  const friendState: FriendRequestState = { lastRequestAtMs: null, sentCount: 0 };

  async function send(chatId: string, text: string, isPrivate: boolean): Promise<void> {
    if (!isPrivate) {
      const target = routeOutgoing(deps.routing, chatId);
      if (target.kind === "suppressed") return;
    }
    const wait = pacer.delayFor(chatId, deps.now());
    if (wait > 0) await deps.sleep(wait);
    await deps.client.sendText(chatId, text);
    pacer.mark(chatId, deps.now());
  }

  async function onMessage(message: ZaloIncomingMessage): Promise<void> {
    const reply = await handleIncoming(
      { text: message.text, customerId: message.senderId, nowMs: deps.now() },
      deps.api,
    );
    const text = renderReply(deps.messages, reply, {
      customerId: message.senderId,
      ratePercent: deps.ratePercent,
      attributionDays: deps.attributionDays,
    });
    if (text !== null) await send(message.chatId, text, message.isPrivate);
  }

  async function maybeAddFriend(userId: string, greeting: string): Promise<boolean> {
    // Only ever called after the person messaged us first.
    const decision = decideFriendRequest(friendState, {
      hasDirectMessage: true,
      nowMs: deps.now(),
      minGapMs: deps.friendRequests.minGapMs,
      maxPerRun: deps.friendRequests.maxPerRun,
    });
    if (decision.kind === "skip") return false;
    await deps.client.addFriend(userId, greeting);
    friendState.lastRequestAtMs = deps.now();
    friendState.sentCount += 1;
    return true;
  }

  return { onMessage, maybeAddFriend };
}
