/**
 * The link queue as the composition root starts it (AD-13, AD-14, AD-25; Stories 5.1, 8.1): the
 * assistant's link-request route when the assistant token is configured, and the link job over
 * the bridge `BRIDGE_MODE` names. Dev links carry the `DEV` sub_id1 prefix that production
 * attribution never credits, and dev request ids carry it too. The fake bridge is never built for production, whatever the config
 * says; the real browser bridge arrives with Story 5.3, and until then a `browser` setup queues
 * requests without serving them.
 */
import type { Clock } from "@cashback/core";

import { fakeBridge, linkRequestInternalRoutes, runLinkJob } from "../modules/linking/index";
import { DEV_SUB_ID_PREFIX } from "../modules/orders/index";
import type { ServerConfig } from "../platform/config/env.config";
import type { Ledger } from "../platform/db/ledger";
import type { InternalRoutes } from "../platform/http/servers";
import { JOB_SCHEDULES } from "../platform/jobs/job-schedules";
import type { Job } from "../platform/jobs/scheduler";
import type { Logger } from "../platform/log/logger";
import type { BridgePort } from "../platform/ports/bridge.port";

export const subIdPrefixFor = (env: ServerConfig["env"]): string => (env === "dev" ? DEV_SUB_ID_PREFIX : "");

/** The bridge for this environment, or null while the real one is not built (Story 5.3). */
export function linkBridge(config: Pick<ServerConfig, "env" | "bridgeMode">): BridgePort | null {
  if (config.bridgeMode !== "fake") return null;
  if (config.env === "prod") throw new Error("the fake bridge never runs in production");
  return fakeBridge();
}

/** What this start runs, for the startup log line `platform.environment.mode` (Story 8.1 AC4). */
export function environmentModes(config: ServerConfig): Record<string, string | boolean> {
  return {
    env: config.env,
    bridge: config.bridgeMode,
    zalo: config.zaloMode,
    subIdPrefix: subIdPrefixFor(config.env),
    tunnel: config.publicBaseUrl !== null,
    assistantRoutes: config.assistantToken !== null,
  };
}

export interface LinkWiringInput {
  readonly config: ServerConfig;
  readonly ledger: Ledger;
  readonly clock: Clock;
  readonly logger: Logger;
}

export function linkRoutes(input: LinkWiringInput): InternalRoutes[] {
  if (input.config.assistantToken === null) {
    input.logger.warn({ env: input.config.env }, "linking.assistant_routes.absent");
    return [];
  }
  return [linkRequestInternalRoutes({ ledger: input.ledger, clock: input.clock, requestIdPrefix: subIdPrefixFor(input.config.env) })];
}

export function linkJobs(input: LinkWiringInput): Job[] {
  const bridge = linkBridge(input.config);
  if (bridge === null) {
    input.logger.warn({ env: input.config.env, bridge: input.config.bridgeMode }, "linking.link_job.absent");
    return [];
  }
  const deps = { ledger: input.ledger, clock: input.clock, bridge, subIdPrefix: subIdPrefixFor(input.config.env), logger: input.logger };
  return [{ name: "links", ...JOB_SCHEDULES.links, run: async (signal) => void (await runLinkJob(deps, signal)) }];
}
