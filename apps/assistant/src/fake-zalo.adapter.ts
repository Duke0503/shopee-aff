/**
 * An in-memory Zalo session (D37). It never connects to Zalo: dev runs it by default and every
 * test uses it. Sends are recorded with the clock's time so a test can check the pace; a test can
 * lose and regain the session to play an account Zalo locked (Story 6.11), raise friend requests
 * and group joins, and play another login taking the account.
 */
import type { Clock, Instant } from "@cashback/core";

import type { ChatTarget, IncomingMessage, Mention, MessageHandler, SessionEvent, SessionEventHandler, TextStyle, ZaloSession } from "./zalo.port";

export interface FakeZaloSession extends ZaloSession {
  readonly sent: readonly { readonly target: ChatTarget; readonly text: string; readonly at: Instant; readonly mentions?: readonly Mention[]; readonly styles?: readonly TextStyle[] }[];
  readonly friendRequests: readonly { readonly userId: string; readonly greeting: string; readonly at: Instant }[];
  readonly accepted: readonly { readonly userId: string; readonly at: Instant }[];
  /** Test helper: the friend requests waiting in Zalo, which `pendingFriendRequests` reads. */
  readonly pending: string[];
  /** Test helper: the next `acceptFriend` calls throw, as Zalo refusing them. */
  failAccepts: number;
  /** Test helper: report a session event (a friend request, a group join, a conflict). */
  emit(event: SessionEvent): void;
  /** Test helper: deliver a message as if a person had written it. */
  deliver(message: IncomingMessage): Promise<void>;
  /** Test helper: Zalo closes the session (the account locked or logged out), then opens it again. */
  lose(): void;
  regain(): void;
}

/** The account id the fake reports unless a test names another (a new account after a lock). */
export const FAKE_ACCOUNT_ID = "fake0000000000000001";

export function fakeZaloSession(clock: Clock, accountId: string = FAKE_ACCOUNT_ID): FakeZaloSession {
  const sent: { target: ChatTarget; text: string; at: Instant; mentions?: readonly Mention[]; styles?: readonly TextStyle[] }[] = [];
  const friendRequests: { userId: string; greeting: string; at: Instant }[] = [];
  const accepted: { userId: string; at: Instant }[] = [];
  let handler: MessageHandler | null = null;
  let events: SessionEventHandler | null = null;
  let open = true;
  let conflicted = false;
  const session: FakeZaloSession = {
    mode: "fake",
    sent,
    friendRequests,
    accepted,
    connected: () => open,
    conflicted: () => conflicted,
    accountId: () => accountId,
    onMessage: (next) => {
      handler = next;
    },
    sendText: async (target, text, mentions, styles) => {
      sent.push({ target, text, at: clock.now(), ...(mentions === undefined ? {} : { mentions }), ...(styles === undefined || styles.length === 0 ? {} : { styles }) });
    },
    onEvent: (next) => {
      events = next;
    },
    addFriend: async (userId, greeting) => {
      friendRequests.push({ userId, greeting, at: clock.now() });
    },
    pending: [],
    failAccepts: 0,
    acceptFriend: async (userId) => {
      if (session.failAccepts > 0) throw new Error(`zalo refused the acceptance (${(session.failAccepts -= 1)} more)`);
      accepted.push({ userId, at: clock.now() });
    },
    pendingFriendRequests: async () => [...session.pending],
    emit: (event) => {
      if (event.kind === "session_conflict") {
        conflicted = true;
        open = false;
      }
      events?.(event);
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
  return session;
}
