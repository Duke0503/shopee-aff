/**
 * The zca-js listener of the real account (zca-zalo.adapter.ts): whether the socket is up, the
 * restart after zca-js gives up, the events besides messages, and a session taken by another login.
 *
 * zca-js says `disconnected` on every drop, retries some codes by itself and says `closed` when it
 * gives up; then the listener is started again with the live assistant's backoff (3 s doubling to
 * 30 s). While it is down `connected()` is false, so the heartbeat reports the loss (Story 6.11).
 *
 * One account carries one session: a second login of it (the old bot left running, Zalo Web) makes
 * Zalo close this socket with code 3000 (duplicate connection) or 3003 (kicked), and every
 * reconnect would kick the other session in turn. So such a close is a conflict: those codes are
 * taken out of zca-js's own retries at start, the listener is stopped for good (a socket zca-js
 * still opens is closed at once) and `session_conflict` is reported. Only a restart of the
 * assistant reconnects. Drops with any other code, however frequent, are a flaky network (owner
 * decision): the listener keeps reconnecting with the backoff, and a long outage is
 * `assistant_down`.
 *
 * Friend requests and group joins are passed on as session events: never a friend request of this
 * account's own, but a join it caused (it added or approved the member) is one, without itself.
 */
import type { API, Message } from "zca-js";

import type { GroupMember, SessionEvent } from "./zalo.port";

/** The live assistant's reconnect delays after zca-js gives up: 3 s, doubling, at most 30 s. */
export const RECONNECT_DELAYS_MS = [3_000, 6_000, 12_000, 24_000, 30_000] as const;
/** zca-js CloseReason.DuplicateConnection and KickConnection: another login took the account. */
export const CONFLICT_CLOSE_CODES: readonly number[] = [3000, 3003];

/** zca-js FriendEventType.REQUEST and GroupEventType.JOIN. */
const FRIEND_REQUEST = 2;
const GROUP_JOIN = "join";

export type ZcaListenerApi = Pick<API, "getOwnId"> & {
  readonly listener: Pick<API["listener"], "on" | "start" | "stop">;
  readonly getContext?: API["getContext"];
};

export interface ConnectionOptions {
  /** Timers for the reconnect backoff; tests pass fake ones. */
  readonly setTimer?: (run: () => void, ms: number) => unknown;
  readonly clearTimer?: (timer: unknown) => void;
}

export interface Connection {
  readonly open: () => boolean;
  readonly conflicted: () => boolean;
  readonly stop: () => void;
}

/** Keeps zca-js from reconnecting on its own after another login took the account. */
function withoutConflictRetries(api: ZcaListenerApi): void {
  const socket = api.getContext?.()?.settings?.features?.socket;
  if (socket && Array.isArray(socket.close_and_retry_codes)) socket.close_and_retry_codes = socket.close_and_retry_codes.filter((code) => !CONFLICT_CLOSE_CODES.includes(code));
}

/** A non-blank string, trimmed, or null: how every text zca-js hands over is read. */
export const nonBlank = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

/** A zca-js friend or group event as a session event, or null when the assistant does not act on it. */
export function sessionEventOf(raw: unknown, ownId: string, from: "friend_event" | "group_event"): SessionEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const event = raw as { type?: unknown; isSelf?: unknown; threadId?: unknown; data?: { fromUid?: unknown; updateMembers?: unknown } };
  if (from === "friend_event") {
    // A join this account caused (it added or approved the member) still welcomes; its own requests do not count.
    if (event.isSelf === true) return null;
    const userId = nonBlank(event.data?.fromUid);
    return event.type === FRIEND_REQUEST && userId !== null && userId !== ownId ? { kind: "friend_request", userId } : null;
  }
  const groupId = nonBlank(event.threadId);
  if (event.type !== GROUP_JOIN || groupId === null || !Array.isArray(event.data?.updateMembers)) return null;
  const members: GroupMember[] = (event.data.updateMembers as { id?: unknown; dName?: unknown }[]).flatMap((m) => {
    const userId = nonBlank(m.id);
    return userId === null || userId === ownId ? [] : [{ userId, name: nonBlank(m.dName) }];
  });
  return members.length === 0 ? null : { kind: "group_join", groupId, members };
}

/** Wires the listener; `deliver` gets every message, `report` every session event. */
export function watchConnection(api: ZcaListenerApi, deliver: (raw: Message) => void, report: (event: SessionEvent) => void, onError: (error: unknown) => void, options: ConnectionOptions): Connection {
  const setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms));
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  let open = false;
  let stopped = false;
  let conflicted = false;
  let attempts = 0;
  let restart: unknown = null;
  const halt = () => {
    stopped = true;
    if (restart !== null) clearTimer(restart);
    restart = null;
    api.listener.stop();
    open = false;
  };
  const scheduleRestart = () => {
    if (stopped || restart !== null) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(attempts, RECONNECT_DELAYS_MS.length - 1)] ?? 30_000;
    attempts += 1;
    restart = setTimer(start, delay);
  };
  // A start that throws (no socket could be made) is tried again with the same backoff, never after stop or a conflict.
  function start(): void {
    restart = null;
    if (stopped) return;
    try {
      api.listener.start({ retryOnClose: true });
    } catch (error) {
      onError(error);
      if (!open) scheduleRestart();
    }
  }
  api.listener.on("connected", () => {
    if (conflicted) return halt();
    open = true;
    attempts = 0;
  });
  api.listener.on("disconnected", (code) => {
    open = false;
    if (stopped || !CONFLICT_CLOSE_CODES.includes(code)) return;
    conflicted = true;
    halt();
    report({ kind: "session_conflict" });
  });
  api.listener.on("closed", () => {
    open = false;
    scheduleRestart();
  });
  // An EventEmitter without an `error` listener throws; a drop is reported by `disconnected`.
  api.listener.on("error", () => undefined);
  api.listener.on("message", deliver);
  const ownId = String(api.getOwnId());
  for (const from of ["friend_event", "group_event"] as const) {
    api.listener.on(from, (raw: unknown) => {
      const event = sessionEventOf(raw, ownId, from);
      if (event !== null) report(event);
    });
  }
  withoutConflictRetries(api);
  start();
  return { open: () => open, conflicted: () => conflicted, stop: halt };
}
