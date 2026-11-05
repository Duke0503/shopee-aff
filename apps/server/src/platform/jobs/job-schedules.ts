/**
 * When each background job runs (AD-13): a fixed delay after the previous run ends, or a
 * Vietnam time of day. The modules supply the run functions when their stories land; the
 * composition root pairs them with these schedules, so every delay is stated once here.
 */
import type { JobSchedule } from "./scheduler";

const every = (delayMs: number, firstDelayMs?: number): JobSchedule => (firstDelayMs === undefined ? { kind: "every", delayMs } : { kind: "every", delayMs, firstDelayMs });
const dailyVn = (hour: number, minute = 0): JobSchedule => ({ kind: "daily_vn", at: { hour, minute } });

export interface JobTiming {
  readonly context: string;
  readonly schedule: JobSchedule;
}

export const JOB_SCHEDULES = {
  links: { context: "linking", schedule: every(5_000) },
  /** Links still not handed over 55 s after their request go by notification (Story 6.5). */
  linkDelivery: { context: "linking", schedule: every(5_000) },
  claimExpiry: { context: "payouts", schedule: every(60_000) },
  /** Unsent notifications older than 7 days are dropped and counted (Story 6.4). */
  notificationExpiry: { context: "messaging", schedule: every(10 * 60_000) },
  /** The one health model checked, and the alert of each part that just went down raised (Story 8.3). */
  health: { context: "operations", schedule: every(60_000) },
  /** The external heartbeat pinged while the health model is green (Story 8.4, AD-29). */
  heartbeat: { context: "operations", schedule: every(5 * 60_000) },
  /** Pending owner alerts sent to Telegram; a failed send is retried on the next run (Story 8.3). */
  alertDelivery: { context: "operations", schedule: every(30_000) },
  /** Customer sign-in throttles pruned and capped, failures on unknown codes tallied (Story 7.2). */
  signInHousekeeping: { context: "identity", schedule: every(60 * 60_000) },
  /** Pending order notices sent to the DP Business group; a failed send stops the run and is retried on the next (D62). */
  orderBusinessNotices: { context: "orders", schedule: every(30_000) },
  /** Hourly; the first run 3 minutes after start, so frequent deploys never postpone it (production 2026-11-03). */
  reconcile: { context: "orders", schedule: every(60 * 60_000, 3 * 60_000) },
  nightlySweep: { context: "orders", schedule: dailyVn(2) },
  /** The checked local archive, then the encrypted copy on Google Drive (Story 8.2). */
  backup: { context: "platform", schedule: dailyVn(3) },
  /** The Shopee payout record page: hourly, read once a day from 09:30 Vietnam time until it succeeds (Story 4.22). */
  /** The first run 5 minutes after start, after the first reconcile has asked the bridge for its pages. */
  payoutRecords: { context: "payouts", schedule: every(60 * 60_000, 5 * 60_000) },
} as const satisfies Record<string, JobTiming>;

export type JobName = keyof typeof JOB_SCHEDULES;

/** How long shutdown waits for the current runs before it closes the ledger anyway. */
export const JOB_STOP_TIMEOUT_MS = 30_000;
