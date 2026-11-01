/**
 * The owner's resume of the Shopee link queue (AD-14, AD-18; Story 5.5 AC4), on the internal
 * listener with the internal token and a signed-in admin's staff token, as every admin command
 * (admin-command.routes.ts). The internal CLI calls it after the affiliate browser was signed in
 * again (docs/operations/bridge-runbook.md). The resume is audited under the admin; the link job
 * then serves the queue in its usual order, oldest request of the highest priority first.
 */
import { LINK_QUEUE_RESUME_PATH, linkQueueResumedSchema, type LinkQueueResumed } from "@cashback/contracts";

import { resumeShopeeQueue } from "../modules/linking/index";
import { commandAudit } from "../modules/operations/index";
import type { InternalRoutes } from "../platform/http/servers";
import { adminActor, type AdminCommandDeps } from "./admin-command.routes";

export function linkQueueRoutes(deps: AdminCommandDeps): InternalRoutes {
  return (app) => {
    app.post(LINK_QUEUE_RESUME_PATH, async (request): Promise<LinkQueueResumed> => {
      const actor = adminActor(deps, request);
      return linkQueueResumedSchema.parse(deps.ledger.tx((db) => resumeShopeeQueue(db, commandAudit(db, deps.clock, actor), deps.clock.now())));
    });
  };
}
