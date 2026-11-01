/**
 * The Zalo assistant's heartbeat (AD-15, Story 6.1).
 *
 *   POST /internal/assistant/heartbeat   internal listener only, `X-Assistant-Token`: record one beat
 *
 * The route is marked as the assistant's, so the listener's token guard checks the assistant token
 * for it and nothing else opens it; without that token it is 401.
 */
import { ASSISTANT_HEARTBEAT_PATH, assistantHeartbeatReceivedSchema, assistantHeartbeatSchema } from "@cashback/contracts";
import type { Clock } from "@cashback/core";
import type { FastifyInstance } from "fastify";

import { HttpError } from "../../../platform/http/error-envelope";
import { ASSISTANT_ROUTE } from "../../../platform/http/internal-token.guard";
import type { AssistantHeartbeats } from "../assistant-heartbeat.command";

export interface AssistantHeartbeatRouteDeps {
  readonly clock: Clock;
  /** The one in-memory store the Overview's health reads too (main.ts builds it once). */
  readonly heartbeats: AssistantHeartbeats;
}

export function assistantHeartbeatRoutes(deps: AssistantHeartbeatRouteDeps): (app: FastifyInstance) => void {
  const { heartbeats } = deps;
  return (app) => {
    app.post(ASSISTANT_HEARTBEAT_PATH, { config: ASSISTANT_ROUTE }, async (request) => {
      const body = assistantHeartbeatSchema.safeParse(request.body);
      if (!body.success) throw new HttpError("invalid_request", "error.invalid_request");
      const received = heartbeats.record(body.data, deps.clock.now());
      return assistantHeartbeatReceivedSchema.parse({ receivedAt: received.receivedAt });
    });
  };
}
