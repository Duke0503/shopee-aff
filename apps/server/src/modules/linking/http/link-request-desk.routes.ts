/**
 * The linking module's desk route (FR-7, FR-37; Story 5.10). Any staff role may use it (FR-24).
 *
 *   GET /api/admin/link-requests   every link request on the list contract; read only
 */
import { DESK_LINK_REQUESTS_PATH, deskLinkRequestsResponseSchema } from "@cashback/contracts";
import type { Clock } from "@cashback/core";

import type { Ledger } from "../../../platform/db/ledger";
import type { StaffRoutes } from "../../../platform/http/staff-routes";
import { answerDeskLinkRequests } from "../link-requests-desk.list";

export interface LinkRequestDeskRouteDeps {
  readonly ledger: Ledger;
  readonly clock: Clock;
}

export function linkRequestDeskRoutes(deps: LinkRequestDeskRouteDeps): StaffRoutes {
  return (add) => {
    add({ method: "GET", url: DESK_LINK_REQUESTS_PATH, handler: async (request) => deskLinkRequestsResponseSchema.parse(answerDeskLinkRequests(deps.ledger.db, request.query, deps.clock)) });
  };
}
