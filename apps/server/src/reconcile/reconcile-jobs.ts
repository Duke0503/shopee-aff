/**
 * The reconciliation jobs as the composition root starts them (AD-13; Stories 3.7, 3.8, 5.9): the
 * hourly run and the nightly sweep over the enabled networks' sources, timed by
 * platform/jobs/job-schedules.ts. AccessTrade is read from its API when its key is set. Shopee is
 * read in production from its report pages through the affiliate browser (`shopeeBridgeSource`,
 * Story 5.9), when the real bridge runs; outside production a saved report (SHOPEE_REPORT_PATH)
 * takes its place when set, so rehearsals and dev never need the browser.
 */
import type { Clock } from "@cashback/core";

import { accessTradeWindowSource, ReportSourceError, shopeeBridgeSource, shopeeFileWindowSource, type WindowedReportSource } from "../modules/linking/index";
import { alertsFor } from "../modules/operations/index";
import type { ServerConfig } from "../platform/config/env.config";
import type { Ledger } from "../platform/db/ledger";
import { JOB_SCHEDULES } from "../platform/jobs/job-schedules";
import type { Job, JobTimer } from "../platform/jobs/scheduler";
import type { Logger } from "../platform/log/logger";
import type { BridgePort } from "../platform/ports/bridge.port";
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
      run: async (signal) => void (await runHourlyReconcile({ ...ctx, signal })),
    },
    {
      name: "nightlySweep",
      ...JOB_SCHEDULES.nightlySweep,
      run: async (signal) => void (await runNightlySweep({ ...ctx, signal, pacing, wait })),
    },
  ];
}
