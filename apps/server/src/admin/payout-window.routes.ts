/**
 * The owner's close of the 72-hour no-payout window (AD-24, D40; Story 8.8), on the internal
 * listener with the internal token and a signed-in admin's staff token, as every admin command
 * (admin-command.routes.ts). The cutover import opened the window; after its end and the go/no-go
 * decision the owner runs `pnpm payout:window off --as <admin>` (docs/operations/go-live-runbook.md).
 * Refused before the end (`window_not_over`); the close is audited under that admin.
 */
import { PAYOUT_WINDOW_PATH, payoutWindowCloseSchema, payoutWindowStateSchema, type PayoutWindowState } from "@cashback/contracts";

import { commandAudit } from "../modules/operations/index";
import { closePayoutWindow, PayoutWindowError } from "../modules/payouts/index";
import { HttpError } from "../platform/http/error-envelope";
import type { InternalRoutes } from "../platform/http/servers";
import { adminActor, type AdminCommandDeps } from "./admin-command.routes";

export function payoutWindowRoutes(deps: AdminCommandDeps): InternalRoutes {
  return (app) => {
    app.post(PAYOUT_WINDOW_PATH, async (request): Promise<PayoutWindowState> => {
      const actor = adminActor(deps, request);
      if (!payoutWindowCloseSchema.safeParse(request.body).success) throw new HttpError("invalid_request", "error.invalid_request");
      try {
        const window = deps.ledger.tx((db) => closePayoutWindow(db, deps.clock.now(), commandAudit(db, deps.clock, actor)));
        return payoutWindowStateSchema.parse({ open: window.open, endsAt: window.endsAt });
      } catch (error) {
        if (error instanceof PayoutWindowError) throw new HttpError("conflict", `error.payout.${error.code}`);
        throw error;
      }
    });
  };
}
