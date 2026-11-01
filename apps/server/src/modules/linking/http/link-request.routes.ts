/**
 * The assistant's link request (FR-1, AD-15, AD-18; Story 5.1).
 *
 *   POST /internal/link-requests   internal listener only, `X-Assistant-Token`: queue one link request
 *
 * The route is marked as the assistant's, so the listener's token guard checks the assistant
 * token for it and nothing else opens it; without that token it is 401. The request is queued in
 * one transaction and the link job serves it.
 */
import { linkRequestCreatedSchema, linkRequestCreateSchema } from "@cashback/contracts";
import type { Clock } from "@cashback/core";
import type { FastifyInstance } from "fastify";

import type { Ledger } from "../../../platform/db/ledger";
import { HttpError } from "../../../platform/http/error-envelope";
import { ASSISTANT_ROUTE } from "../../../platform/http/internal-token.guard";
import { LinkRequestError, queueLinkRequest, type LinkRequestErrorCode } from "../link-request.command";

export interface LinkRequestRouteDeps {
  readonly ledger: Ledger;
  readonly clock: Clock;
  /** `DEV` in dev, empty in production (AD-25). */
  readonly requestIdPrefix: string;
}

const STATUS: Record<LinkRequestErrorCode, "not_found" | "forbidden" | "invalid_request" | "busy"> = {
  customer_not_found: "not_found",
  customer_disabled: "forbidden",
  customer_id_unusable: "invalid_request",
  network_unsupported: "invalid_request",
  day_full: "busy",
};

export function linkRequestInternalRoutes(deps: LinkRequestRouteDeps): (app: FastifyInstance) => void {
  return (app) => {
    app.post("/internal/link-requests", { config: ASSISTANT_ROUTE }, async (request) => {
      const body = linkRequestCreateSchema.safeParse(request.body);
      if (!body.success) throw new HttpError("invalid_request", "error.invalid_request");
      try {
        const queued = deps.ledger.tx((db) => queueLinkRequest(db, { ...body.data, channel: "zalo" }, deps.clock, deps.requestIdPrefix));
        return linkRequestCreatedSchema.parse({ requestId: queued.requestId, status: queued.status });
      } catch (error) {
        if (error instanceof LinkRequestError) throw new HttpError(STATUS[error.code], `error.link.${error.code}`);
        throw error;
      }
    });
  };
}
