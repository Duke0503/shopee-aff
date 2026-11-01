/**
 * An in-memory Zalo session (D37). It never connects to Zalo: dev runs it by default and every
 * test uses it. Sends are recorded with the clock's time so a test can check the pace.
 */
import type { Clock, Instant } from "@cashback/core";

import type { ChatTarget, IncomingMessage, MessageHandler, ZaloSession } from "./zalo.port";

export interface FakeZaloSession extends ZaloSession {
  readonly sent: readonly { readonly target: ChatTarget; readonly text: string; readonly at: Instant }[];
  readonly friendRequests: readonly { readonly userId: string; readonly greeting: string; readonly at: Instant }[];
  /** Test helper: deliver a message as if a person had written it. */
  deliver(message: IncomingMessage): Promise<void>;
}

export function fakeZaloSession(clock: Clock): FakeZaloSession {
  const sent: { target: ChatTarget; text: string; at: Instant }[] = [];
  const friendRequests: { userId: string; greeting: string; at: Instant }[] = [];
  let handler: MessageHandler | null = null;
  let open = true;
  return {
    mode: "fake",
    sent,
    friendRequests,
    connected: () => open,
    onMessage: (next) => {
      handler = next;
    },
    sendText: async (target, text) => {
      sent.push({ target, text, at: clock.now() });
    },
    addFriend: async (userId, greeting) => {
      friendRequests.push({ userId, greeting, at: clock.now() });
    },
    stop: async () => {
      open = false;
    },
    deliver: async (message) => {
      if (handler === null) throw new Error("no message handler registered");
      await handler(message);
    },
  };
}
