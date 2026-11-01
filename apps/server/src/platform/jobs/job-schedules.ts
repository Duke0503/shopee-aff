/**
 * When each background job runs (AD-13): a fixed delay after the previous run ends, or a
 * Vietnam time of day. The modules supply the run functions when their stories land; the
 * composition root pairs them with these schedules, so every delay is stated once here.
 */
import type { JobSchedule } from "./scheduler";

const every = (delayMs: number): JobSchedule => ({ kind: "every", delayMs });
const dailyVn = (hour: number, minute = 0): JobSchedule => ({ kind: "daily_vn", at: { hour, minute } });

export interface JobTiming {
  readonly context: string;
  readonly schedule: JobSchedule;
}

export const JOB_SCHEDULES = {
  links: { context: "linking", schedule: every(5_000) },
  claimExpiry: { context: "payouts", schedule: every(60_000) },
  health: { context: "operations", schedule: every(60_000) },
  reconcile: { context: "orders", schedule: every(60 * 60_000) },
  nightlySweep: { context: "orders", schedule: dailyVn(2) },
  backup: { context: "platform", schedule: dailyVn(3) },
  /** The Shopee payout record page: hourly, read once a day from 09:30 Vietnam time until it succeeds (Story 4.22). */
  payoutRecords: { context: "payouts", schedule: every(60 * 60_000) },
} as const satisfies Record<string, JobTiming>;

export type JobName = keyof typeof JOB_SCHEDULES;

/** How long shutdown waits for the current runs before it closes the ledger anyway. */
export const JOB_STOP_TIMEOUT_MS = 30_000;
