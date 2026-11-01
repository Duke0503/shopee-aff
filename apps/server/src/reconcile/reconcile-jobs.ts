/**
 * The reconciliation jobs as the composition root starts them (AD-13; Stories 3.7, 3.8, 5.9): the
 * hourly run and the nightly sweep over the enabled networks' sources, timed by
 * platform/jobs/job-schedules.ts. AccessTrade is read from its API when its key is set. Shopee is
 * read in production from its report pages through the affiliate browser (`shopeeBridgeSource`,
 * Story 5.9), when the real bridge runs; outside production a saved report (SHOPEE_REPORT_PATH)
 * takes its place when set, so rehearsals and dev never need the browser. While
 * `messaging.silent` is on (after the cutover import, Story 6.10) each run ends with one log line
 * of its would-be sends, counted per event and message key.
 */
import type { Clock, Instant } from "@cashback/core";

import { accessTradeWindowSource, ReportSourceError, shopeeBridgeSource, shopeeFileWindowSource, type WindowedReportSource } from "../modules/linking/index";
import { alertsFor } from "../modules/operations/index";
import type { ServerConfig } from "../platform/config/env.config";
import type { Ledger } from "../platform/db/ledger";
import { JOB_SCHEDULES } from "../platform/jobs/job-schedules";
import type { Job, JobTimer } from "../platform/jobs/scheduler";
import type { Logger } from "../platform/log/logger";
import type { BridgePort } from "../platform/ports/bridge.port";
import { isSilent, wouldBeSends } from "../modules/messaging/index";
import { runHourlyReconcile, type ReconcileContext } from "./hourly-reconcile.job";
import { runNightlySweep, SWEEP_PACING, timerWait, type Wait } from "./nightly-sweep.job";

/** What the Shopee bridge source needs from the composition root. */
export interface ShopeeReportWiring {
  readonly bridge: BridgePort;
  readonly ledger: Ledger;
  readonly clock: Clock;
  readonly wait: Wait;
  readonly logger?: Logger;
}

type SourceConfig = Pick<ServerConfig, "env" | "accesstradeApiKey" | "shopeeReportPath">;

/**
 * Production without a bridge that reads report pages: never skipped in silence. Every run of it
 * records a FAILED Shopee run (`report_source_unavailable`), which the Overview's reconciliation
 * health shows as down and the repeated-failure alert reports.
 */
export const UNWIRED_SHOPEE_SOURCE: WindowedReportSource = {
  network: "shopee",
  read: () => Promise.reject(new ReportSourceError("report_source_unavailable", "production has no browser bridge that reads the Shopee report; Shopee orders are not reconciled")),
};

function shopeeSource(config: SourceConfig, wiring: ShopeeReportWiring | undefined): WindowedReportSource | null {
  if (config.env !== "prod" && config.shopeeReportPath !== null) return shopeeFileWindowSource({ path: config.shopeeReportPath });
  if (wiring === undefined || wiring.bridge.readReportPage === undefined) return config.env === "prod" ? UNWIRED_SHOPEE_SOURCE : null;
  const { bridge, ledger, clock, wait, logger } = wiring;
  return shopeeBridgeSource({ bridge, ledger, clock, wait, alerts: (db) => alertsFor(db, clock, logger) });
}

export function reconcileSources(config: SourceConfig, shopee?: ShopeeReportWiring): WindowedReportSource[] {
  const sources: WindowedReportSource[] = [];
  const fromShopee = shopeeSource(config, shopee);
  if (fromShopee !== null) sources.push(fromShopee);
  if (config.accesstradeApiKey !== null) sources.push(accessTradeWindowSource({ apiKey: config.accesstradeApiKey }));
  return sources;
}

export interface ReconcileJobsInput {
  readonly config: ServerConfig;
  readonly ledger: Ledger;
  readonly clock: Clock;
  readonly timer: JobTimer;
  readonly logger: Logger;
  /** The one bridge of this start; the real one reads the Shopee report (Story 5.9). */
  readonly bridge?: BridgePort;
}

/** The would-be sends of one run, while quiet: one log line of counts, no customer (Story 6.10). */
export function logWouldBeSends(ctx: Pick<ReconcileContext, "ledger" | "logger">, since: Instant, job: string): void {
  if (!isSilent(ctx.ledger.db)) return;
  ctx.logger.warn({ job, ...wouldBeSends(ctx.ledger.db, since) }, "messaging.outbox.would_be_sends");
}

/** Runs one job and then logs its would-be sends, also when the run failed (what it recorded still counts). */
export async function reportingWouldBeSends(ctx: Pick<ReconcileContext, "ledger" | "logger" | "clock">, job: string, run: () => Promise<unknown>): Promise<void> {
  const since = ctx.clock.now();
  try {
    await run();
  } finally {
    logWouldBeSends(ctx, since, job);
  }
}

export function reconcileJobs(input: ReconcileJobsInput): Job[] {
  const ctx: ReconcileContext = {
    ledger: input.ledger,
    clock: input.clock,
    logger: input.logger,
    sources: reconcileSources(input.config, input.bridge === undefined ? undefined : { bridge: input.bridge, ledger: input.ledger, clock: input.clock, wait: timerWait(input.timer), logger: input.logger }),
    production: input.config.env === "prod",
    devOnly: input.config.env === "dev",
  };
  if (ctx.sources.length === 0) input.logger.warn({}, "orders.reconciliation.no_sources");
  if (ctx.sources.includes(UNWIRED_SHOPEE_SOURCE)) input.logger.error({ env: input.config.env }, "orders.reconciliation.shopee_unwired");
  const pacing = { ...SWEEP_PACING, pauseMs: input.config.sweepPauseMs ?? SWEEP_PACING.pauseMs };
  const wait = timerWait(input.timer);
  // Each run gets the scheduler's stop signal: the read, the pause and the next slice honour it.
  return [
    {
      name: "reconcile",
      ...JOB_SCHEDULES.reconcile,
      run: (signal) => reportingWouldBeSends(ctx, "reconcile", () => runHourlyReconcile({ ...ctx, signal })),
    },
    {
      name: "nightlySweep",
      ...JOB_SCHEDULES.nightlySweep,
      run: (signal) => reportingWouldBeSends(ctx, "nightlySweep", () => runNightlySweep({ ...ctx, signal, pacing, wait })),
    },
  ];
}
