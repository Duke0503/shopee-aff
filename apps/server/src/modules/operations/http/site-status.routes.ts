/**
 * What every customer page asks first (AD-15, FR-36; Stories 6.11 and 7.1):
 *
 *   GET /api/site-status   public listener, no session: `{ assistant, fallbackContactUrl, assistantUrl }`
 *
 * The assistant is "down" exactly while the health check has it marked down (no connected
 * heartbeat for 5 minutes); the website then shows the Zalo-down banner and sends every Zalo
 * button to the fallback contact path from the config. The answer names no time, account or
 * reason, and is never cached, so the next page load after the assistant is back has no banner.
 * It also names the assistant's private chat the Zalo buttons open (ZALO_ASSISTANT_URL).
 */
import { SITE_STATUS_PATH, siteStatusResponseSchema, type SiteStatusResponse } from "@cashback/contracts";
import type { FastifyInstance } from "fastify";

import type { AssistantHeartbeats } from "../assistant-heartbeat.command";

export interface SiteStatusRouteDeps {
  readonly heartbeats: Pick<AssistantHeartbeats, "downSince">;
  /** FALLBACK_CONTACT_URL; null when the owner has not set one. */
  readonly fallbackContactUrl: string | null;
  /** ZALO_ASSISTANT_URL; null when the owner has not set it. */
  readonly assistantUrl: string | null;
}

export function siteStatusRoutes(deps: SiteStatusRouteDeps): (app: FastifyInstance) => void {
  return (app) => {
    app.get(SITE_STATUS_PATH, async (_request, reply): Promise<SiteStatusResponse> => {
      void reply.header("cache-control", "no-store");
      return siteStatusResponseSchema.parse({ assistant: deps.heartbeats.downSince() === null ? "up" : "down", fallbackContactUrl: deps.fallbackContactUrl, assistantUrl: deps.assistantUrl });
    });
  };
}
