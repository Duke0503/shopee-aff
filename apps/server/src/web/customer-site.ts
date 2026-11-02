/**
 * The composition of the customer website's server side (AD-18, AD-21; Stories 7.1 and 7.2): the
 * site status every page reads (assistant down, the fallback contact path, the assistant's chat),
 * the customer sign-in routes with their Origin check, client keys, burst watch and the hourly
 * housekeeping job, the signed-in customer's money, orders and payouts (Stories 7.3 and 7.4), and the built website itself when apps/web/dist exists (a dev start without a
 * build serves the API only; the Vite dev server serves the pages then). The receipt, share and
 * proof routes stay as they are and win over the website's catch-all. Later customer stories add
 * their routes here.
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CUSTOMER_PATHS } from "@cashback/contracts";
import type { Clock } from "@cashback/core";

import { customerSessionRoutes, runSignInHousekeeping, signInBurstWatch, unknownSignInTally } from "../modules/identity/index";
import { alertsFor, auditFor, siteStatusRoutes, type AssistantHeartbeats } from "../modules/operations/index";
import type { ServerConfig } from "../platform/config/env.config";
import { REPOSITORY_ROOT } from "../platform/config/env.config";
import type { Ledger } from "../platform/db/ledger";
import { clientKeyer } from "../platform/http/client-key";
import { siteOrigins } from "../platform/http/origin.guard";
import type { PublicRoutes } from "../platform/http/servers";
import { staticBuildRoutes } from "../platform/http/static-site";
import { JOB_SCHEDULES } from "../platform/jobs/job-schedules";
import type { Job } from "../platform/jobs/scheduler";
import type { Logger } from "../platform/log/logger";
import { myMoneyRoutes } from "./my-money.routes";

export const WEB_DIST = join(REPOSITORY_ROOT, "apps", "web", "dist");
/** The website's Vite dev server (apps/web/vite.config.ts), allowed as an origin in dev only. */
export const WEB_DEV_ORIGINS = ["http://localhost:5175", "http://127.0.0.1:5175"] as const;

type SiteConfig = Pick<ServerConfig, "env" | "publicBaseUrl" | "publicPort" | "fallbackContactUrl" | "zaloAssistantUrl" | "staffAccess" | "fingerprintKey">;

/**
 * The origins a mutating customer request may come from: the public base URL and its www twin.
 * Production cannot start without PUBLIC_BASE_URL (isolation.config.ts); dev has none and allows
 * the website's dev server and its own port.
 */
export function customerOrigins(config: Pick<ServerConfig, "env" | "publicBaseUrl" | "publicPort">): string[] {
  const origins = config.publicBaseUrl === null ? [] : siteOrigins(config.publicBaseUrl);
  if (config.env === "dev") origins.push(...WEB_DEV_ORIGINS, `http://127.0.0.1:${config.publicPort}`, `http://localhost:${config.publicPort}`);
  return origins;
}

export interface CustomerSiteDeps {
  readonly config: SiteConfig;
  readonly ledger: Ledger;
  readonly clock: Clock;
  readonly heartbeats: AssistantHeartbeats;
  readonly logger?: Logger;
  /** The build folder; apps/web/dist unless a test names another. */
  readonly dist?: string;
}

export interface CustomerSite {
  readonly routes: PublicRoutes[];
  readonly jobs: Job[];
}

export function customerSite(deps: CustomerSiteDeps): CustomerSite {
  const { config, ledger, clock } = deps;
  const unknown = unknownSignInTally();
  // Client keys need a secret that outlives the request; without FINGERPRINT_KEY (dev) one per process.
  const clientKey = clientKeyer(config.fingerprintKey ?? randomBytes(32).toString("hex"));
  const routes: PublicRoutes[] = [
    siteStatusRoutes({ heartbeats: deps.heartbeats, fallbackContactUrl: config.fallbackContactUrl, assistantUrl: config.zaloAssistantUrl }),
    customerSessionRoutes({ ledger, clock, auditFor: (db) => auditFor(db, clock), alertsFor: (db) => alertsFor(db, clock, deps.logger), burst: signInBurstWatch(), unknown, clientKey, origins: customerOrigins(config) }),
    myMoneyRoutes({ ledger, clock }),
  ];
  const dist = deps.dist ?? WEB_DIST;
  if (existsSync(join(dist, "index.html"))) routes.push(staticBuildRoutes({ kind: "site", root: dist, pagePaths: Object.values(CUSTOMER_PATHS), otherHosts: config.staffAccess ? [config.staffAccess.adminHost] : [] }));
  else deps.logger?.warn({ dist }, "platform.web.build_absent");
  const housekeeping: Job = { name: "signInHousekeeping", ...JOB_SCHEDULES.signInHousekeeping, run: () => void runSignInHousekeeping({ ledger, clock, unknown, auditFor: (db) => auditFor(db, clock), ...(deps.logger ? { logger: deps.logger } : {}) }) };
  return { routes, jobs: [housekeeping] };
}
