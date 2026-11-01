/**
 * The Overview on the admin desk (FR-25, Story 4.17): `GET /api/admin/overview?period=thisMonth`
 * (or `period=custom&from=YYYY-MM-DD&to=YYYY-MM-DD`). Any staff role may read it; nothing here
 * writes. Every figure comes from overview.query.ts, read in one snapshot; the desk only formats.
 */
import { overviewQuerySchema, overviewSchema } from "@cashback/contracts";
import type { Clock } from "@cashback/core";

import type { Ledger } from "../platform/db/ledger";
import { HttpError } from "../platform/http/error-envelope";
import type { StaffRoutes } from "../platform/http/staff-routes";
import type { LastHeartbeat } from "./overview-activity.query";
import { overviewOf, periodOf } from "./overview.query";

export interface OverviewRouteDeps {
  readonly ledger: Ledger;
  readonly clock: Clock;
  /** The assistant's last heartbeat, from the store its heartbeat route writes (Story 6.1). */
  readonly lastHeartbeat?: LastHeartbeat;
}

export function overviewRoutes({ ledger, clock, lastHeartbeat }: OverviewRouteDeps): StaffRoutes {
  return (add) => {
    add({
      method: "GET",
      url: "/api/admin/overview",
      handler: async (request) => {
        const query = overviewQuerySchema.safeParse(request.query ?? {});
        if (!query.success) throw new HttpError("invalid_request", "error.overview.bad_period");
        // Only the period is the caller's mistake; any later fault is the server's (500, logged).
        try {
          periodOf(query.data, clock);
        } catch {
          throw new HttpError("invalid_request", "error.overview.bad_period");
        }
        // One read transaction: every block of the answer sees the same snapshot of the ledger.
        const overview = ledger.sqlite.transaction(() => overviewOf(ledger.db, query.data, clock, lastHeartbeat)).deferred();
        return overviewSchema.parse(overview);
      },
    });
  };
}
