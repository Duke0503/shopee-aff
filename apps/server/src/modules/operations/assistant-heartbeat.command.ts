/**
 * The Zalo assistant's last heartbeat (AD-15, AD-27, Story 6.1), kept in memory: it says only
 * whether the assistant is alive now, so nothing is lost when the server restarts (the next beat
 * arrives within 60 s). The health model of the Overview reads it. Raising the owner alert and the
 * website's Zalo-down banner after 5 minutes without a beat is a later story; this file only
 * records.
 */
import type { AssistantHeartbeat } from "@cashback/contracts";
import type { Instant } from "@cashback/core";

export interface ReceivedHeartbeat {
  readonly receivedAt: Instant;
  readonly beat: AssistantHeartbeat;
}

export interface AssistantHeartbeats {
  record(beat: AssistantHeartbeat, receivedAt: Instant): ReceivedHeartbeat;
  /** The last beat since this server started, or null when none arrived yet. */
  last(): ReceivedHeartbeat | null;
}

export function assistantHeartbeats(): AssistantHeartbeats {
  let latest: ReceivedHeartbeat | null = null;
  return {
    record(beat, receivedAt) {
      latest = { receivedAt, beat };
      return latest;
    },
    last: () => latest,
  };
}
