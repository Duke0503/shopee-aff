/**
 * An in-memory Zalo session (D37). It never connects to Zalo: dev runs it by default and every
 * test uses it. Sends are recorded with the clock's time so a test can check the pace; a test can
 * lose and regain the session to play an account Zalo locked (Story 6.11).
 */
import type { Clock, Instant } from "@cashback/core";

import type { ChatTarget, IncomingMessage, Mention, MessageHandler, ZaloSession } from "./zalo.port";

export interface FakeZaloSession extends ZaloSession {
  readonly sent: readonly { readonly target: ChatTarget; readonly text: string; readonly at: Instant; readonly mentions?: readonly Mention[] }[];
  readonly friendRequests: readonly { readonly userId: string; readonly greeting: string; readonly at: Instant }[];
  /** Test helper: deliver a message as if a person had written it. */
  deliver(message: IncomingMessage): Promise<void>;
  /** Test helper: Zalo closes the session (the account locked or logged out), then opens it again. */
  lose(): void;
  regain(): void;
}

/** The account id the fake reports unless a test names another (a new account after a lock). */
export const FAKE_ACCOUNT_ID = "fake0000000000000001";

export function fakeZaloSession(clock: Clock, accountId: string = FAKE_ACCOUNT_ID): FakeZaloSession {
  const sent: { target: ChatTarget; text: string; at: Instant; mentions?: readonly Mention[] }[] = [];
  const friendRequests: { userId: string; greeting: string; at: Instant }[] = [];
  let handler: MessageHandler | null = null;
  let open = true;
  return {
    mode: "fake",
    sent,
    friendRequests,
    connected: () => open,
    accountId: () => accountId,
    onMessage: (next) => {
      handler = next;
    },
    sendText: async (target, text, mentions) => {
      sent.push({ target, text, at: clock.now(), ...(mentions === undefined ? {} : { mentions }) });
    },
    addFriend: async (userId, greeting) => {
      friendRequests.push({ userId, greeting, at: clock.now() });
    },
    stop: async () => {
      open = false;
    },
    lose: () => {
      open = false;
    },
    regain: () => {
      open = true;
    },
    deliver: async (message) => {
      if (handler === null) throw new Error("no message handler registered");
      await handler(message);
    },
  };
}
