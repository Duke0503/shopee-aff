/**
 * The Zalo assistant's heartbeat (AD-15, Story 6.1).
 *
 *   POST /internal/assistant/heartbeat   internal listener only, `X-Assistant-Token`: record one beat
 *
 * The route is marked as the assistant's, so the listener's token guard checks the assistant token
 * for it and nothing else opens it; without that token it is 401. A beat that names the session's
 * Zalo account stores the first time that account was seen (identity, Story 6.11): the latest one
 * is when the account was switched, the default start of the merge proposals.
 */
import { ASSISTANT_HEARTBEAT_PATH, assistantHeartbeatReceivedSchema, assistantHeartbeatSchema } from "@cashback/contracts";
import type { Clock } from "@cashback/core";
import type { FastifyInstance } from "fastify";

import { noteZaloAccount } from "../../identity/index";
import type { Ledger } from "../../../platform/db/ledger";
import { HttpError } from "../../../platform/http/error-envelope";
import { ASSISTANT_ROUTE } from "../../../platform/http/internal-token.guard";
import type { AssistantHeartbeats } from "../assistant-heartbeat.command";

export interface AssistantHeartbeatRouteDeps {
  readonly clock: Clock;
  /** The one in-memory store the Overview's health reads too (main.ts builds it once). */
  readonly heartbeats: AssistantHeartbeats;
  /** Where the Zalo accounts seen are kept; without it they are not recorded. */
  readonly ledger?: Ledger;
}

export function assistantHeartbeatRoutes(deps: AssistantHeartbeatRouteDeps): (app: FastifyInstance) => void {
  const { heartbeats } = deps;
  return (app) => {
    app.post(ASSISTANT_HEARTBEAT_PATH, { config: ASSISTANT_ROUTE }, async (request) => {
      const body = assistantHeartbeatSchema.safeParse(request.body);
      if (!body.success) throw new HttpError("invalid_request", "error.invalid_request");
      const received = heartbeats.record(body.data, deps.clock.now());
      const account = body.data.account;
      if (deps.ledger !== undefined && typeof account === "string" && deps.ledger.tx((db) => noteZaloAccount(db, account, received.receivedAt))) request.log.warn({}, "identity.zalo_account.first_seen");
      return assistantHeartbeatReceivedSchema.parse({ receivedAt: received.receivedAt });
    });
  };
}
