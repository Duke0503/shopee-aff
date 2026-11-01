/**
 * A send-only Zalo session through the live bot (owner's testing policy, Story 6.3), for end-to-end
 * checks on the production host without a second login of the production account: a second login
 * would cut the live bot off. It posts to the live bot's own local broadcast API on loopback,
 * `POST http://127.0.0.1:8891/api/broadcast`, always with `{"group": "test"}`, which the live bot
 * maps to the Dev group. It is held to that: a private target, any group other than the one Dev
 * group configured, and every friend request are refused before anything is sent; it never asks
 * for the main group and never names a user. It hears nothing, so it registers no one.
 *
 * Only main.ts builds it, only with `ZALO_MODE=relay` in dev (assistant.config.ts); no test sends
 * through it except with a fake `fetch`.
 */
import type { FetchLike } from "./internal-api.adapter";
import { ZaloTargetRefused } from "./zalo-target.guard";
import type { ZaloSession } from "./zalo.port";

export const LIVE_BOT_BROADCAST_URL = "http://127.0.0.1:8891/api/broadcast";
/** The live bot's name for the Dev group; the only group this session ever asks for. */
export const RELAY_GROUP = "test";
const RELAY_TIMEOUT_MS = 15_000;

export class RelaySendError extends Error {
  constructor(readonly status: number | null) {
    super(`live bot broadcast failed${status === null ? "" : ` with ${status}`}`);
    this.name = "RelaySendError";
  }
}

export interface RelayOptions {
  /** The live bot's `x-assistant-token` (LIVE_BOT_TOKEN). */
  readonly token: string;
  /** The one Dev group id the session may write to. */
  readonly devGroupId: string;
  readonly fetch: FetchLike;
}

export function relayZaloSession(options: RelayOptions): ZaloSession {
  let open = true;
  return {
    mode: "relay",
    connected: () => open,
    onMessage: () => undefined,
    sendText: async (target, text, mentions) => {
      if (target.kind !== "group" || target.groupId !== options.devGroupId) throw new ZaloTargetRefused();
      const response = await options
        .fetch(LIVE_BOT_BROADCAST_URL, {
          method: "POST",
          headers: { "content-type": "application/json", "x-assistant-token": options.token },
          body: JSON.stringify({ group: RELAY_GROUP, message: text, ...(mentions === undefined || mentions.length === 0 ? {} : { mentions: mentions.map((m) => ({ uid: m.userId, pos: m.pos, len: m.len })) }) }),
          signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
        })
        .catch(() => {
          throw new RelaySendError(null);
        });
      if (response.status < 200 || response.status > 299) throw new RelaySendError(response.status);
    },
    addFriend: async () => {
      throw new ZaloTargetRefused();
    },
    stop: async () => {
      open = false;
    },
  };
}
