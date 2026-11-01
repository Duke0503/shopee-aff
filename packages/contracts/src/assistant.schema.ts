/**
 * The Zalo assistant's heartbeat (AD-15, Story 6.1), on the internal listener only with
 * `X-Assistant-Token`. The assistant posts it every 60 s; the server keeps the last one in memory
 * for the health model. A missing heartbeat raising the owner alert and the website's Zalo-down
 * banner is a later story. The body names no customer and carries no secret.
 */
import { INSTANT_PATTERN } from "@cashback/core";
import { z } from "zod";

export const ASSISTANT_HEARTBEAT_PATH = "/internal/assistant/heartbeat";

/** How often the assistant sends its heartbeat (AD-15). */
export const ASSISTANT_HEARTBEAT_INTERVAL_MS = 60_000;

export const ZALO_SESSION_MODES = ["fake", "account"] as const;
export const ZALO_SESSION_STATES = ["connected", "disconnected"] as const;

export const assistantHeartbeatSchema = z.strictObject({
  /** `fake` in dev and tests (D37), `account` with a real Zalo session. */
  zalo: z.enum(ZALO_SESSION_MODES),
  session: z.enum(ZALO_SESSION_STATES),
  /** When this assistant process started. */
  startedAt: z.string().regex(INSTANT_PATTERN),
  /** Sends waiting in the pacer: a growing number means the assistant is behind. */
  queuedSends: z.number().int().min(0).max(100_000),
});
export type AssistantHeartbeat = z.infer<typeof assistantHeartbeatSchema>;

export const assistantHeartbeatReceivedSchema = z.object({ receivedAt: z.string().regex(INSTANT_PATTERN) });
export type AssistantHeartbeatReceived = z.infer<typeof assistantHeartbeatReceivedSchema>;
