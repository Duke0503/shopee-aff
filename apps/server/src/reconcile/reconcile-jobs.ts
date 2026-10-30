/**
 * The reconciliation jobs as the composition root starts them (AD-13; Stories 3.7, 3.8): the
 * hourly run and the nightly sweep over the enabled networks' sources, timed by
 * platform/jobs/job-schedules.ts. AccessTrade is read from its API when its key is set. Shopee is
 * read from a saved report when SHOPEE_REPORT_PATH is set; in production it will be the browser
 * bridge (`shopeeBridgeSource`, Story 5.9), behind the same port, so only this choice changes.
 */
import type { Clock } from "@cashback/core";

import { accessTradeWindowSource, shopeeFileWindowSource, type WindowedReportSource } from "../modules/linking/index";
import type { ServerConfig } from "../platform/config/env.config";
import type { Ledger } from "../platform/db/ledger";
import { JOB_SCHEDULES } from "../platform/jobs/job-schedules";
import type { Job, JobTimer } from "../platform/jobs/scheduler";
import type { Logger } from "../platform/log/logger";
import { runHourlyReconcile, type ReconcileContext } from "./hourly-reconcile.job";
import { runNightlySweep, SWEEP_PACING, timerWait } from "./nightly-sweep.job";

export function reconcileSources(config: Pick<ServerConfig, "accesstradeApiKey" | "shopeeReportPath">): WindowedReportSource[] {
  const sources: WindowedReportSource[] = [];
  // TODO(Story 5.9): production Shopee reads through shopeeBridgeSource() instead of a saved file.
  if (config.shopeeReportPath !== null) sources.push(shopeeFileWindowSource({ path: config.shopeeReportPath }));
  if (config.accesstradeApiKey !== null) sources.push(accessTradeWindowSource({ apiKey: config.accesstradeApiKey }));
  return sources;
}

export interface ReconcileJobsInput {
  readonly config: ServerConfig;
  readonly ledger: Ledger;
  readonly clock: Clock;
  readonly timer: JobTimer;
  readonly logger: Logger;
}

export function reconcileJobs(input: ReconcileJobsInput): Job[] {
  const ctx: ReconcileContext = {
    ledger: input.ledger,
    clock: input.clock,
    logger: input.logger,
    sources: reconcileSources(input.config),
    production: input.config.env === "prod",
  };
  if (ctx.sources.length === 0) input.logger.warn({}, "orders.reconciliation.no_sources");
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
