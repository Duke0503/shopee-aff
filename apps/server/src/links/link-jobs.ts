/**
 * The link queue as the composition root starts it (AD-13, AD-14, AD-25; Stories 5.1, 8.1): the
 * assistant's link-request route when the assistant token is configured, and the link job over
 * the bridge `BRIDGE_MODE` names. Dev links carry the `DEV` sub_id1 prefix that production
 * attribution never credits, and dev request ids carry it too. The fake bridge is never built
 * for production, whatever the config says. With `BRIDGE_MODE=browser` the real bridge (Story 5.3)
 * is built once: its long-poll routes go on the internal listener behind the bridge token, and the
 * link job hands it one submission at a time.
 */
import type { Clock } from "@cashback/core";

import { bridgeInternalRoutes, browserBridge, fakeBridge, linkRequestInternalRoutes, runLinkJob } from "../modules/linking/index";
import { DEV_SUB_ID_PREFIX } from "../modules/orders/index";
import type { ServerConfig } from "../platform/config/env.config";
import type { Ledger } from "../platform/db/ledger";
import type { InternalRoutes } from "../platform/http/servers";
import { JOB_SCHEDULES } from "../platform/jobs/job-schedules";
import { systemTimer, type Job } from "../platform/jobs/scheduler";
import type { Logger } from "../platform/log/logger";
import type { BridgePort } from "../platform/ports/bridge.port";

export const subIdPrefixFor = (env: ServerConfig["env"]): string => (env === "dev" ? DEV_SUB_ID_PREFIX : "");

/**
 * The one bridge of this start and the internal routes that belong to it: the in-process fake
 * (never in production, no routes) or the affiliate browser with its long-poll routes. Built once
 * by the composition root and handed to both `linkRoutes` and `linkJobs`, so the routes always
 * reach the very queue the link job feeds.
 */
export interface LinkBridge {
  readonly port: BridgePort;
  readonly routes: readonly InternalRoutes[];
}

export function linkBridge(config: Pick<ServerConfig, "env" | "bridgeMode">): LinkBridge {
  if (config.bridgeMode === "browser") {
    const browser = browserBridge({ timer: systemTimer });
    return { port: browser, routes: [bridgeInternalRoutes({ work: browser.work })] };
  }
  if (config.env === "prod") throw new Error("the fake bridge never runs in production");
  return { port: fakeBridge(), routes: [] };
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
    bridgeRoutes: config.bridgeMode === "browser" && config.bridgeToken !== null,
  };
}

export interface LinkWiringInput {
  readonly config: ServerConfig;
  readonly ledger: Ledger;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** The bridge's own routes, and the assistant's link-request route when its token is configured. */
export function linkRoutes(input: LinkWiringInput, bridge: LinkBridge): InternalRoutes[] {
  if (input.config.assistantToken === null) {
    input.logger.warn({ env: input.config.env }, "linking.assistant_routes.absent");
    return [...bridge.routes];
  }
  return [...bridge.routes, linkRequestInternalRoutes({ ledger: input.ledger, clock: input.clock, requestIdPrefix: subIdPrefixFor(input.config.env) })];
}

export function linkJobs(input: LinkWiringInput, bridge: LinkBridge): Job[] {
  const deps = { ledger: input.ledger, clock: input.clock, bridge: bridge.port, subIdPrefix: subIdPrefixFor(input.config.env), logger: input.logger };
  return [{ name: "links", ...JOB_SCHEDULES.links, run: async (signal) => void (await runLinkJob(deps, signal)) }];
}
