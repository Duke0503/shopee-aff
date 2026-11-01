/**
 * The assistant's heartbeat (AD-15): one beat at start and one every 60 s to
 * `/internal/assistant/heartbeat`, so the server knows the Zalo session is alive. A failed beat is
 * logged and the loop goes on; the server notices the gap and alerts the owner after 5 minutes
 * without a connected beat (Story 6.11). A session Zalo closed is reported as `disconnected` and
 * logged once when it is first seen. The loop ends when `signal` aborts.
 */
import { ASSISTANT_HEARTBEAT_INTERVAL_MS, type AssistantHeartbeat } from "@cashback/contracts";
import type { Instant } from "@cashback/core";

import type { InternalApi } from "./internal-api.adapter";
import type { Sleep } from "./pacer";
import type { ZaloSession } from "./zalo.port";

/**
 * The beat as of now; `onLost` is called once each time the session goes from connected to lost.
 * Loss is armed only by a connected beat, so a start before the session opens is no loss; a
 * session that never connects is still reported `disconnected`, and the server counts it down 5
 * minutes after it started watching.
 */
export function sessionBeat(zalo: Pick<ZaloSession, "mode" | "connected" | "accountId">, startedAt: Instant, queuedSends: () => number, onLost: () => void): () => AssistantHeartbeat {
  let wasConnected = false;
  return () => {
    const connected = zalo.connected();
    if (wasConnected && !connected) onLost();
    wasConnected = connected;
    return { zalo: zalo.mode, session: connected ? "connected" : "disconnected", account: zalo.accountId(), startedAt, queuedSends: queuedSends() };
  };
}

export interface HeartbeatDeps {
  readonly api: InternalApi;
  readonly sleep: Sleep;
  /** The beat as of now. */
  readonly beat: () => AssistantHeartbeat;
  readonly onFailure: (error: unknown) => void;
  readonly signal: AbortSignal;
  readonly intervalMs?: number;
}

export async function runHeartbeat(deps: HeartbeatDeps): Promise<void> {
  const interval = deps.intervalMs ?? ASSISTANT_HEARTBEAT_INTERVAL_MS;
  while (!deps.signal.aborted) {
    try {
      await deps.api.heartbeat(deps.beat(), deps.signal);
    } catch (error) {
      if (!deps.signal.aborted) deps.onFailure(error);
    }
    await deps.sleep(interval, deps.signal);
  }
}
