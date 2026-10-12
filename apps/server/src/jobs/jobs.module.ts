import { Module } from "@nestjs/common";

import { accessTradeConfigFromEnv, HttpAccessTrade } from "../modules/affiliate/providers/accesstrade.client";
import { nowLocalIso } from "../modules/identity";
import { DELIVERY_PORT, type DeliveryPort, MESSAGES } from "../notifications/delivery";
import type { Messages } from "../notifications/messages";
import { NotificationsModule } from "../notifications/notifications.module";
import { DB, DatabaseModule } from "../shared/database/database.module";
import type { Db } from "../shared/database/connection";
import { cashbackRate } from "../shared/config/cashback-rate";
import { JobRunner, type ScheduledJob } from "./job-runner";
import { createNotifyJob } from "./notify.job";
import { createAccessTradeReconcileJob } from "./reconcile-accesstrade.job";

/** Jobs are off unless asked for, so a dev copy never messages customers. */
function jobsEnabled(): boolean {
  const flag = process.env.JOBS_ENABLED;
  if (flag !== undefined) return flag === "true";
  return process.env.NODE_ENV === "production";
}

/**
 * The notify loop always runs; AccessTrade reconciliation only runs when its
 * API key is set, so an unconfigured copy does not fail a job every pass.
 */
function scheduledJobs(db: Db, delivery: DeliveryPort, messages: Messages): ScheduledJob[] {
  const jobs: ScheduledJob[] = [
    createNotifyJob({
      db,
      delivery,
      messages,
      now: () => new Date().toISOString(),
      intervalMs: Number(process.env.NOTIFY_INTERVAL_MS ?? 10_000),
      cashbackRate: cashbackRate(),
    }),
  ];

  const accessTrade = accessTradeConfigFromEnv();
  if (accessTrade.apiKey !== "") {
    jobs.push(
      createAccessTradeReconcileJob({
        db,
        orders: new HttpAccessTrade(accessTrade),
        now: () => nowLocalIso(),
        intervalMs: Number(process.env.ACCESSTRADE_RECONCILE_INTERVAL_MS ?? 600_000),
        cashbackRate: cashbackRate(),
      }),
    );
  }

  return jobs;
}

@Module({
  imports: [DatabaseModule, NotificationsModule],
  providers: [
    {
      provide: JobRunner,
      inject: [DB, DELIVERY_PORT, MESSAGES],
      useFactory: (db: Db, delivery: DeliveryPort, messages: Messages) =>
        new JobRunner(scheduledJobs(db, delivery, messages), {
          enabled: jobsEnabled(),
          alert: (text) => delivery.sendTelegram(text, "dev"),
        }),
    },
  ],
  exports: [JobRunner],
})
export class JobsModule {}
