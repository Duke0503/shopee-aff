/**
 * The assistant's notification routes (AD-15, AD-16, D9, D46; Stories 6.4 and 6.5), on the
 * internal listener only, behind `X-Assistant-Token`:
 *
 *   GET  /internal/notifications/next        at most one due notification, leased to the assistant
 *   POST /internal/notifications/<id>/ack    it was sent, or the assistant has no text for it
 *
 * The handout, its lease, the 7-day limit and the daily cap are messaging's
 * (notification-delivery.command.ts); this file binds the owner alerts to the same transaction
 * and, for a "link ready" notification, adds the link reply facts the chat reply would carry (the
 * share link, never the affiliate link), read at the moment it goes out.
 *
 * Dev never messages a customer from production data: a dev ledger made by the cutover import
 * (it holds seeded keys) hands out nothing (AD-25).
 */
import {
  NOTIFICATION_ACK_ROUTE,
  NOTIFICATION_NEXT_PATH,
  notificationAckedSchema,
  notificationAckSchema,
  notificationNextSchema,
  type AssistantNotification,
} from "@cashback/contracts";
import type { Clock } from "@cashback/core";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { z } from "zod";

import { linkReplyOf } from "../links/assistant-chat.routes";
import { requestOfDeliveredKey } from "../modules/linking/index";
import { acknowledgeNotification, handOutNext, holdsCutoverSeeds, type HandedOutNotification } from "../modules/messaging/index";
import { alertsFor } from "../modules/operations/index";
import type { Ledger, LedgerDb } from "../platform/db/ledger";
import { HttpError } from "../platform/http/error-envelope";
import { ASSISTANT_ROUTE } from "../platform/http/internal-token.guard";
import type { InternalRoutes } from "../platform/http/servers";

export interface NotificationRouteDeps {
  readonly ledger: Ledger;
  readonly clock: Clock;
  /** The hard cap on proactive sends per Vietnam day (NOTIFICATION_DAILY_CAP). */
  readonly dailyCap: number;
  /** The public origin share links are written on. */
  readonly shareBaseUrl: string;
  /** False in dev: a ledger imported from production hands out nothing. */
  readonly production: boolean;
}

const ackParams = z.strictObject({ id: z.coerce.number().int().positive() });

/** The notification as the assistant reads it; a "link ready" one with its link reply facts. */
function notificationOf(db: LedgerDb, deps: NotificationRouteDeps, row: HandedOutNotification): AssistantNotification {
  const requestId = requestOfDeliveredKey(row.dedupKey);
  const link = requestId === null ? null : linkReplyOf(db, deps, requestId, row.customerId);
  return { id: row.id, dedupKey: row.dedupKey, zaloUserId: row.zaloUserId, messageKey: row.messageKey, params: row.params, link };
}

function next(deps: NotificationRouteDeps, log: FastifyBaseLogger): AssistantNotification | null {
  return deps.ledger.tx((db) => {
    if (!deps.production && holdsCutoverSeeds(db)) {
      log.warn({}, "messaging.notifications.dev_imported_ledger");
      return null;
    }
    const handout = handOutNext(db, deps.clock, { dailyCap: deps.dailyCap, alerts: alertsFor(db, deps.clock, log) });
    if (handout.noRecipient > 0) log.warn({ noRecipient: handout.noRecipient }, "messaging.notifications.no_recipient");
    if (handout.kind === "capped") log.warn({ dailyCap: deps.dailyCap }, "messaging.notifications.daily_cap");
    return handout.kind === "row" ? notificationOf(db, deps, handout.row) : null;
  });
}

export function notificationRoutes(deps: NotificationRouteDeps): InternalRoutes {
  return (app: FastifyInstance) => {
    app.get(NOTIFICATION_NEXT_PATH, { config: ASSISTANT_ROUTE }, async (request) => notificationNextSchema.parse({ notification: next(deps, request.log) }));

    app.post(NOTIFICATION_ACK_ROUTE, { config: ASSISTANT_ROUTE }, async (request) => {
      const params = ackParams.safeParse(request.params);
      const body = notificationAckSchema.safeParse(request.body);
      if (!params.success || !body.success) throw new HttpError("invalid_request", "error.invalid_request");
      const outcome = deps.ledger.tx((db) => acknowledgeNotification(db, deps.clock, params.data.id, body.data.result, alertsFor(db, deps.clock, request.log)));
      if (outcome === "not_found") throw new HttpError("not_found", "error.notification.not_found");
      request.log.info({ id: params.data.id, outcome }, "messaging.notification.acknowledged");
      return notificationAckedSchema.parse({ id: params.data.id, outcome });
    });
  };
}
