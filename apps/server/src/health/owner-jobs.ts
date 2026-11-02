/**
 * The owner's safety jobs as the composition root starts them (AD-26, AD-27; Stories 8.2, 8.3):
 * the daily backup, the health check over the one health model, and the Telegram delivery of
 * stored alerts, timed by platform/jobs/job-schedules.ts. The Overview and the health check are
 * given the same health sources from here, so they always give the same answer.
 *
 * Without a Telegram configuration alerts are stored and logged only; production logs that as an
 * error at every start. A start that fails at its pre-migration backup cannot wait for the
 * delivery job, so its alert is sent at once (`startupAlerts`).
 */
import type { Clock } from "@cashback/core";

import { deliverPendingAlerts, healthCheck, immediateAlerts, ledgerAlerts, readHealthModel, telegramSender, type AssistantHeartbeats, type HealthSources } from "../modules/operations/index";
import { backupHealth, backupStatusPath, readBackupStatus, type BackupHealth } from "../platform/backup/backup-status";
import { runDailyBackup, type DailyBackupDeps } from "../platform/backup/daily-backup.job";
import { offsiteStore, type RunExecutable } from "../platform/backup/offsite.adapter";
import type { ServerConfig } from "../platform/config/env.config";
import type { Ledger } from "../platform/db/ledger";
import { JOB_SCHEDULES } from "../platform/jobs/job-schedules";
import type { Job } from "../platform/jobs/scheduler";
import type { Logger } from "../platform/log/logger";
import type { AlertPort } from "../platform/ports/alert.port";

export type OwnerJobsConfig = Pick<ServerConfig, "env" | "dataDir" | "telegram" | "backupOffsite" | "assistantToken">;

export interface OwnerJobsDeps {
  readonly config: OwnerJobsConfig;
  readonly ledger: Ledger;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly heartbeats: AssistantHeartbeats;
  /** The health sources the Overview reads too (`healthSourcesFor`), built once by the composition root. */
  readonly health: HealthSources;
  /** Tests replace the age and rclone runner. */
  readonly run?: RunExecutable;
}

/** The last backup's health, read from its status file at each call. */
export const lastBackupOf =
  (dataDir: string) =>
  (now: Parameters<typeof backupHealth>[1]): BackupHealth =>
    backupHealth(readBackupStatus(backupStatusPath(dataDir)), now);

/** The sources of the one health model; the assistant counts only when it is configured. */
export function healthSourcesFor(config: OwnerJobsConfig, heartbeats: AssistantHeartbeats): HealthSources {
  return { ...(config.assistantToken !== null ? { assistant: (now) => heartbeats.liveness(now) } : {}), backup: lastBackupOf(config.dataDir) };
}

export function dailyBackupDeps(deps: OwnerJobsDeps, alerts: AlertPort): DailyBackupDeps {
  const { config } = deps;
  return {
    ledger: deps.ledger,
    dataDir: config.dataDir,
    clock: deps.clock,
    logger: deps.logger,
    alerts,
    offsite: config.backupOffsite === null ? null : offsiteStore(config.backupOffsite, deps.run),
    offsiteRequired: config.env === "prod",
  };
}

export function ownerJobs(deps: OwnerJobsDeps): Job[] {
  const { config, ledger, clock, logger } = deps;
  const alerts = ledgerAlerts(ledger, clock, logger);
  const backup: Job = { name: "backup", ...JOB_SCHEDULES.backup, run: async (signal) => void (await runDailyBackup(dailyBackupDeps(deps, alerts), signal)) };
  const check = healthCheck({ model: () => readHealthModel(ledger, clock, deps.health), alerts, clock, logger, ...(config.assistantToken !== null ? { heartbeats: deps.heartbeats } : {}) });
  const health: Job = { name: "health", ...JOB_SCHEDULES.health, run: () => void check.run() };
  if (config.telegram === null) {
    logger[config.env === "prod" ? "error" : "warn"]({ env: config.env }, "operations.alert.telegram_absent");
    return [backup, health];
  }
  const sender = telegramSender(config.telegram);
  const delivery: Job = { name: "alertDelivery", ...JOB_SCHEDULES.alertDelivery, run: async () => void (await deliverPendingAlerts(ledger, sender, clock, logger)) };
  return [backup, health, delivery];
}

/** The alert port of the startup migration gate: sent at once, since no job runs after a refused start. */
export function startupAlerts(config: Pick<ServerConfig, "telegram">, logger: Logger): AlertPort & { settled(): Promise<void> } {
  if (config.telegram === null) {
    return { alert: (kind, severity) => logger.error({ kind, severity, result: "not_sent" }, "operations.alert.raised"), settled: async () => undefined };
  }
  return immediateAlerts(telegramSender(config.telegram), logger);
}
