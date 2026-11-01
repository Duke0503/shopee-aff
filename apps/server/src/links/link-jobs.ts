/**
 * The link queue as the composition root starts it (AD-13, AD-14, AD-25; Stories 5.1, 8.1): the
 * assistant's link-request route when the assistant token is configured, and the link job over
 * the bridge `BRIDGE_MODE` names. Dev links carry the `DEV` sub_id1 prefix that production
 * attribution never credits, and dev request ids carry it too. The fake bridge is never built
 * for production, whatever the config says. With `BRIDGE_MODE=browser` the real bridge (Story 5.3)
 * is built once: its long-poll routes go on the internal listener behind the bridge token, and the
 * link job hands it one submission at a time. The job also gets the outbox and alerts of its
 * results (Story 5.5) and the AccessTrade creator (Story 5.7); without a creator the assistant's
 * route refuses TikTok Shop links when they are submitted. After its links the run makes the
 * product lookups (Story 5.6) through the same bridge.
 */
import type { Clock } from "@cashback/core";

import { accessTradeLinkCreator, bridgeInternalRoutes, browserBridge, fakeAccessTradeLinks, fakeBridge, linkRequestInternalRoutes, runLinkJob, runProductLookups, type LinkCreator, type LinkEffects } from "../modules/linking/index";
import { outboxFor } from "../modules/messaging/index";
import { alertsFor, commandAudit } from "../modules/operations/index";
import { DEV_SUB_ID_PREFIX } from "../modules/orders/index";
import type { ServerConfig } from "../platform/config/env.config";
import type { Ledger, LedgerDb } from "../platform/db/ledger";
import type { InternalRoutes } from "../platform/http/servers";
import { JOB_SCHEDULES } from "../platform/jobs/job-schedules";
import { systemTimer, type Job } from "../platform/jobs/scheduler";
import type { Logger } from "../platform/log/logger";
import type { Actor } from "../platform/ports/audit.port";
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
  return [...bridge.routes, linkRequestInternalRoutes({ ledger: input.ledger, clock: input.clock, requestIdPrefix: subIdPrefixFor(input.config.env), tikTok: accessTradeLinksFor(input.config) !== null })];
}

/** The actor of the link job's own writes: the "link failed" outbox rows (AD-17). */
export const LINKS_ACTOR: Actor = { kind: "system", id: "links" };

/** The outbox and the owner alerts, bound to one result transaction (Story 5.5). */
export function linkEffectsFor(clock: Clock, logger?: Logger): (db: LedgerDb) => LinkEffects {
  return (db) => ({ outbox: outboxFor(db, clock, commandAudit(db, clock, LINKS_ACTOR)), alerts: alertsFor(db, clock, logger) });
}

/**
 * The AccessTrade link creator (Story 5.7): the API with the configured key (dev may hold the
 * production key only with ALLOW_PROD_ACCESSTRADE_KEY=1, checked at startup, Story 8.1); in dev
 * without a key the fake creator; in production without one none, and TikTok Shop links are
 * refused when submitted (`tiktok_unavailable`).
 */
export function accessTradeLinksFor(config: Pick<ServerConfig, "env" | "accesstradeApiKey">): LinkCreator | null {
  if (config.accesstradeApiKey !== null) return accessTradeLinkCreator({ apiKey: config.accesstradeApiKey });
  return config.env === "dev" ? fakeAccessTradeLinks() : null;
}

export function linkJobs(input: LinkWiringInput, bridge: LinkBridge): Job[] {
  const deps = {
    ledger: input.ledger,
    clock: input.clock,
    bridge: bridge.port,
    subIdPrefix: subIdPrefixFor(input.config.env),
    logger: input.logger,
    effects: linkEffectsFor(input.clock, input.logger),
    accessTrade: accessTradeLinksFor(input.config),
  };
  // Product lookups (Story 5.6) follow the run's link submissions and yield to any link that comes due.
  const run = async (signal: AbortSignal): Promise<void> => {
    const links = await runLinkJob(deps, signal);
    if (!links.interrupted && !signal.aborted) await runProductLookups(deps, signal);
  };
  return [{ name: "links", ...JOB_SCHEDULES.links, run }];
}
