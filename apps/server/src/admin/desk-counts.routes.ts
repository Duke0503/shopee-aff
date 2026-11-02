/**
 * The sidebar's counts on the admin desk (Story 4.4, wireframe sidebar badges): how many customers
 * the Payouts "payable" tab holds (the queue's own rows, so the badge and the tab agree) and how
 * many review cases are open. Any staff role may read it; the shell polls it, and nothing else
 * refetches with it, so a list behind an open panel stays as it is.
 *
 *   GET /api/admin/counts
 */
import { deskCountsSchema } from "@cashback/contracts";
import type { Clock } from "@cashback/core";

import { openReviewCaseCount } from "../modules/orders/index";
import { payoutQueueCounts } from "../modules/payouts/index";
import type { Ledger } from "../platform/db/ledger";
import type { StaffRoutes } from "../platform/http/staff-routes";

export interface DeskCountsRouteDeps {
  readonly ledger: Ledger;
  readonly clock: Clock;
}

export function deskCountsRoutes({ ledger, clock }: DeskCountsRouteDeps): StaffRoutes {
  return (add) => {
    add({
      method: "GET",
      url: "/api/admin/counts",
      handler: async () =>
        deskCountsSchema.parse(
          ledger.sqlite.transaction(() => ({ payable: payoutQueueCounts(ledger.db, clock).payable, openReviewCases: openReviewCaseCount(ledger.db) })).deferred(),
        ),
    });
  };
}
