/**
 * The Zalo assistant's heartbeats and whether it is down (AD-15, AD-27, FR-36; Stories 6.1 and
 * 6.11), kept in memory: they say only whether the assistant can reach customers now, so nothing
 * is lost when the server restarts (the next beat arrives within 60 s).
 *
 * The assistant is up while a beat with its Zalo session connected came in the last 5 minutes. It
 * is down once 5 minutes pass without one: the process stopped beating, or it beats with the
 * session lost (Zalo locked the account, or logged it out). Before any connected beat it is not
 * known yet, until 5 minutes after this server started watching, when it counts as down too. The
 * health check (assistant-health.job.ts) marks the down state, which the Overview's health and the
 * website banner read (Story 7.1).
 */
import type { AssistantHeartbeat } from "@cashback/contracts";
import { parseInstant, toMs, type Instant } from "@cashback/core";

/** The assistant is down once no connected heartbeat came for this long (AD-15). */
export const ASSISTANT_DOWN_AFTER_MS = 5 * 60_000;

export interface ReceivedHeartbeat {
  readonly receivedAt: Instant;
  readonly beat: AssistantHeartbeat;
}

export type AssistantState = "up" | "down" | "unknown";

export interface AssistantLiveness {
  readonly state: AssistantState;
  /** The last connected beat, or null before the first. */
  readonly at: Instant | null;
}

export interface AssistantHeartbeats {
  record(beat: AssistantHeartbeat, receivedAt: Instant): ReceivedHeartbeat;
  /** The last beat since this server started, or null when none arrived yet. */
  last(): ReceivedHeartbeat | null;
  /** The last beat with the Zalo session connected. */
  lastConnected(): ReceivedHeartbeat | null;
  /** Up, down or not known yet at `now`, from the beats alone. */
  liveness(now: Instant): AssistantLiveness;
  /** Since when the health check has the assistant marked down, or null while it is not. */
  downSince(): Instant | null;
  markDown(at: Instant): void;
  markUp(): void;
}

/** `watchingSince`: when this server started; without it the assistant is never down before its first connected beat. */
export function assistantHeartbeats(watchingSince: Instant | null = null): AssistantHeartbeats {
  let latest: ReceivedHeartbeat | null = null;
  let connected: ReceivedHeartbeat | null = null;
  let down: Instant | null = null;
  const late = (now: Instant, from: Instant): boolean => toMs(now) - toMs(parseInstant(from)) > ASSISTANT_DOWN_AFTER_MS;
  return {
    record(beat, receivedAt) {
      latest = { receivedAt, beat };
      if (beat.session === "connected") connected = latest;
      return latest;
    },
    last: () => latest,
    lastConnected: () => connected,
    liveness(now) {
      if (connected !== null) return { state: late(now, connected.receivedAt) ? "down" : "up", at: connected.receivedAt };
      return { state: watchingSince !== null && late(now, watchingSince) ? "down" : "unknown", at: null };
    },
    downSince: () => down,
    markDown(at) {
      down ??= at;
    },
    markUp() {
      down = null;
    },
  };
}
