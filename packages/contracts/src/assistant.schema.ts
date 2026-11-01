/**
 * The Zalo assistant's heartbeat (AD-15, Story 6.1), on the internal listener only with
 * `X-Assistant-Token`. The assistant posts it every 60 s; the server keeps the last one in memory
 * for the health model. Five minutes without a beat whose session is `connected` raise the owner
 * alert and the down state the website's banner reads (Story 6.11). The body names no customer and
 * carries no secret.
 */
import { INSTANT_PATTERN } from "@cashback/core";
import { z } from "zod";

export const ASSISTANT_HEARTBEAT_PATH = "/internal/assistant/heartbeat";

/** How often the assistant sends its heartbeat (AD-15). */
export const ASSISTANT_HEARTBEAT_INTERVAL_MS = 60_000;

export const ZALO_SESSION_MODES = ["fake", "account", "relay"] as const;
export const ZALO_SESSION_STATES = ["connected", "disconnected"] as const;

export const assistantHeartbeatSchema = z.strictObject({
  /** `fake` in dev and tests (D37), `account` with a real Zalo session, `relay` the send-only Dev group path. */
  zalo: z.enum(ZALO_SESSION_MODES),
  session: z.enum(ZALO_SESSION_STATES),
  /** When this assistant process started. */
  startedAt: z.string().regex(INSTANT_PATTERN),
  /**
   * The Zalo account the session runs on (its own id), or null when the session has none (the
   * relay). The server keeps the first time it sees each account: a new one is a switch, after
   * which known customers are registered again under new Zalo ids (Story 6.11).
   */
  account: z.string().regex(/^[A-Za-z0-9]{1,40}$/).nullable().optional(),
  /** Sends waiting in the pacer: a growing number means the assistant is behind. */
  queuedSends: z.number().int().min(0).max(100_000),
});
export type AssistantHeartbeat = z.infer<typeof assistantHeartbeatSchema>;

export const assistantHeartbeatReceivedSchema = z.object({ receivedAt: z.string().regex(INSTANT_PATTERN) });
export type AssistantHeartbeatReceived = z.infer<typeof assistantHeartbeatReceivedSchema>;
