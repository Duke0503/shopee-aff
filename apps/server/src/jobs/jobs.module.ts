import { Module } from "@nestjs/common";

import { DELIVERY_PORT, type DeliveryPort, MESSAGES } from "../notifications/delivery";
import type { Messages } from "../notifications/messages";
import { NotificationsModule } from "../notifications/notifications.module";
import { DB, DatabaseModule } from "../shared/database/database.module";
import type { Db } from "../shared/database/connection";
import { JobRunner } from "./job-runner";
import { createNotifyJob } from "./notify.job";

/** Jobs are off unless asked for, so a dev copy never messages customers. */
function jobsEnabled(): boolean {
  const flag = process.env.JOBS_ENABLED;
  if (flag !== undefined) return flag === "true";
  return process.env.NODE_ENV === "production";
}

@Module({
  imports: [DatabaseModule, NotificationsModule],
  providers: [
    {
      provide: JobRunner,
      inject: [DB, DELIVERY_PORT, MESSAGES],
      useFactory: (db: Db, delivery: DeliveryPort, messages: Messages) =>
        new JobRunner(
          [
            createNotifyJob({
              db,
              delivery,
              messages,
              now: () => new Date().toISOString(),
              intervalMs: Number(process.env.NOTIFY_INTERVAL_MS ?? 10_000),
            }),
          ],
          {
            enabled: jobsEnabled(),
            alert: (text) => delivery.sendTelegram(text, "dev"),
          },
        ),
    },
  ],
  exports: [JobRunner],
})
export class JobsModule {}
