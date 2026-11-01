/**
 * The notification expiry job (AD-13, AD-16; Story 6.4): every 10 minutes the unsent rows older
 * than 7 days are dropped and counted (a leased row never is), so the handout itself never has to
 * sweep. Sending a pile of week-old news after an outage reads as spam.
 */
import type { Clock } from "@cashback/core";

import { dropExpiredNotifications } from "../modules/messaging/index";
import type { Ledger } from "../platform/db/ledger";
import { JOB_SCHEDULES } from "../platform/jobs/job-schedules";
import type { Job } from "../platform/jobs/scheduler";
import type { Logger } from "../platform/log/logger";

export function runNotificationExpiry(ledger: Ledger, clock: Clock, logger?: Pick<Logger, "warn">): number {
  const dropped = ledger.tx((db) => dropExpiredNotifications(db, clock));
  if (dropped > 0) logger?.warn({ dropped }, "messaging.notifications.expired");
  return dropped;
}

export function notificationJobs(ledger: Ledger, clock: Clock, logger: Logger): Job[] {
  return [{ name: "notificationExpiry", ...JOB_SCHEDULES.notificationExpiry, run: () => void runNotificationExpiry(ledger, clock, logger) }];
}
