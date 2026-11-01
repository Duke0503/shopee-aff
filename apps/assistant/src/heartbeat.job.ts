/**
 * The assistant's heartbeat (AD-15): one beat at start and one every 60 s to
 * `/internal/assistant/heartbeat`, so the server knows the Zalo session is alive. A failed beat is
 * logged and the loop goes on; the server notices the gap (the missing-heartbeat alert is a later
 * story). The loop ends when `signal` aborts.
 */
import { ASSISTANT_HEARTBEAT_INTERVAL_MS, type AssistantHeartbeat } from "@cashback/contracts";

import type { InternalApi } from "./internal-api.adapter";
import type { Sleep } from "./pacer";

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
