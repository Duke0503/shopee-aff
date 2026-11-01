/**
 * The owner's switch of `messaging.silent` (AD-16, AD-24, D46; Story 6.10), on the internal
 * listener with the internal token and a signed-in admin's staff token, as every admin command
 * (admin-command.routes.ts). The cutover import turns the flag on; once the first run's would-be
 * sends were read, the owner turns it off with `pnpm messaging:silent off --as <admin>`. The
 * change is audited under that admin. Turning it off makes only notifications enqueued after it
 * due; the would-be sends recorded while it was on never are.
 */
import { MESSAGING_SILENT_PATH, messagingSilentSchema, messagingSilentSetSchema, type MessagingSilentSet } from "@cashback/contracts";

import { setSilent } from "../modules/messaging/index";
import { commandAudit } from "../modules/operations/index";
import { HttpError } from "../platform/http/error-envelope";
import type { InternalRoutes } from "../platform/http/servers";
import { adminActor, type AdminCommandDeps } from "./admin-command.routes";

export function messagingSilentRoutes(deps: AdminCommandDeps): InternalRoutes {
  return (app) => {
    app.post(MESSAGING_SILENT_PATH, async (request): Promise<MessagingSilentSet> => {
      const actor = adminActor(deps, request);
      const body = messagingSilentSchema.safeParse(request.body);
      if (!body.success) throw new HttpError("invalid_request", "error.invalid_request");
      return messagingSilentSetSchema.parse(deps.ledger.tx((db) => setSilent(db, body.data.silent, deps.clock.now(), commandAudit(db, deps.clock, actor))));
    });
  };
}
