/**
 * The composition of the admin desk's server side (AD-1, AD-18, Story 4.2): the staff gate (admin
 * host, Cloudflare Access check, staff sessions from identity) and each module's staff routes,
 * bound to the ledger. platform/http never imports a module, so the parts meet here. Later
 * stories add their modules' staff routes to the list.
 */
import type { Clock } from "@cashback/core";

import { staffSessionRoutes, staffSessionsFor } from "../modules/identity/index";
import { auditFor, commandAudit } from "../modules/operations/index";
import { reviewCaseRoutes } from "../modules/orders/index";
import { payoutRoutes } from "../modules/payouts/index";
import type { StaffAccessConfig } from "../platform/config/env.config";
import type { Ledger } from "../platform/db/ledger";
import type { Logger } from "../platform/log/logger";
import { cloudflareAccessKeys, type AccessKeySource } from "../platform/http/access-jwt.guard";
import type { StaffGate, StaffRoutes } from "../platform/http/staff-routes";
import { applyDepsFor, reviewReadDepsFor } from "../reconcile/apply-deps";

export interface AdminDeskDeps {
  readonly access: StaffAccessConfig;
  readonly ledger: Ledger;
  readonly clock: Clock;
  /** Production never credits a DEV sub_id (AD-25). */
  readonly production: boolean;
  /** Tests pass their own signing keys; production fetches the team's. */
  readonly keys?: AccessKeySource;
  /** Where a failed key fetch is reported while the held keys still verify. */
  readonly logger?: Logger;
}

export interface AdminDesk {
  readonly gate: StaffGate;
  readonly routes: readonly StaffRoutes[];
}

export function adminDesk(deps: AdminDeskDeps): AdminDesk {
  const { access, ledger, clock } = deps;
  const gate: StaffGate = {
    adminHost: access.adminHost,
    access: { teamDomain: access.accessTeamDomain, audience: access.accessAudience, clock, keys: deps.keys ?? cloudflareAccessKeys(access.accessTeamDomain, clock, { onStale: (info) => deps.logger?.warn(info, "http.staff.access_keys_stale") }) },
    sessions: staffSessionsFor(ledger.db, clock),
  };
  const routes = [
    staffSessionRoutes({ ledger, clock, auditFor: (db) => auditFor(db, clock) }),
    reviewCaseRoutes({
      ledger,
      applyDeps: (db, actor) => applyDepsFor(db, clock, { production: deps.production, actor }),
      readDeps: (actor) => reviewReadDepsFor(ledger.db, clock, actor, deps.production),
    }),
    payoutRoutes({ ledger, clock, audit: (db, actor) => commandAudit(db, clock, actor) }),
  ];
  return { gate, routes };
}
