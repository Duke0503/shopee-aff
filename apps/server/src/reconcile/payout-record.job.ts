/**
 * The daily Shopee payout record run (FR-19, AD-13, AD-14, D59; Story 4.22): page 1 of the payout
 * record page through the affiliate browser, then each batch recorded through the network-payout
 * recording of Story 4.21, in process and in its own transaction, as the system actor
 * `network-sync`. That recording is idempotent: a batch already recorded with the same facts is a
 * replay that writes nothing, so a second run on the same day records nothing new; a paid batch is
 * matched to its exact orders and its withholding classified there.
 *
 * The job wakes every hour; from 09:30 Vietnam time it reads the page until one read of the day
 * succeeds, then rests until the next day. A read the bridge could not serve (no browser, the queue
 * held or paused) raises a warning alert and is tried again the next hour.
 *
 * A page that cannot be read whole (no known record shape, an unreadable amount, an unknown status)
 * writes nothing: the run fails loudly and raises an owner alert. A captcha or the login page holds
 * or pauses the Shopee queue (and alerts) in the adapter. A batch whose status the recording refuses
 * to move back is skipped and named in a warning alert; the others are still recorded.
 */
import { toMs, vnDateOf, vnDayStart, type Clock, type VnDate, type VnTimeOfDay } from "@cashback/core";

import { PayoutRecordError, readShopeePayouts } from "../modules/linking/index";
import { alertsFor, commandAudit } from "../modules/operations/index";
import { NETWORK_SYNC_ACTOR, NetworkSettlementError, recordNetworkPayout } from "../modules/payouts/index";
import type { Ledger } from "../platform/db/ledger";
import { JOB_SCHEDULES } from "../platform/jobs/job-schedules";
import type { Job } from "../platform/jobs/scheduler";
import type { Logger } from "../platform/log/logger";
import type { BridgePort } from "../platform/ports/bridge.port";

export const PAYOUT_RECORD_ALERTS = {
  unreadable: { kind: "shopee_payout_record_unreadable", severity: "high" },
  failed: { kind: "shopee_payout_record_failed", severity: "warning" },
  unavailable: { kind: "shopee_payout_record_unavailable", severity: "warning" },
  refused: { kind: "shopee_payout_status_refused", severity: "warning" },
} as const;

export interface PayoutRecordDeps {
  readonly ledger: Ledger;
  readonly clock: Clock;
  readonly bridge: BridgePort;
  readonly logger: Logger;
}

export interface PayoutRecordRun {
  readonly batches: number;
  /** Batches that changed something (new, moved on, matched). */
  readonly recorded: number;
  readonly replays: number;
  readonly refused: number;
}

const alert = (deps: PayoutRecordDeps, which: keyof typeof PAYOUT_RECORD_ALERTS): void => {
  const { kind, severity } = PAYOUT_RECORD_ALERTS[which];
  deps.ledger.tx((db) => alertsFor(db, deps.clock, deps.logger).alert(kind, severity));
};

export async function runShopeePayoutRecords(deps: PayoutRecordDeps, signal: AbortSignal): Promise<PayoutRecordRun> {
  let records;
  try {
    records = await readShopeePayouts({ bridge: deps.bridge, ledger: deps.ledger, clock: deps.clock, alerts: (db) => alertsFor(db, deps.clock, deps.logger) }, signal);
  } catch (error) {
    if (error instanceof PayoutRecordError) {
      deps.logger.error({ code: error.code, reason: error.message }, "payouts.payout_record.read_failed");
      if (error.code === "payout_record_unreadable") alert(deps, "unreadable");
      else if (error.code === "payout_record_failed") alert(deps, "failed");
      else alert(deps, "unavailable");
    }
    throw error;
  }
  let recorded = 0;
  let replays = 0;
  let refused = 0;
  for (const record of records) {
    try {
      const outcome = deps.ledger.tx((db) => recordNetworkPayout(db, record, { clock: deps.clock, by: commandAudit(db, deps.clock, NETWORK_SYNC_ACTOR) }));
      if (outcome.replay) replays++;
      else recorded++;
    } catch (error) {
      if (!(error instanceof NetworkSettlementError)) throw error;
      refused++;
      deps.logger.warn({ networkPayoutId: record.networkPayoutId, code: error.code }, "payouts.payout_record.refused");
    }
  }
  if (refused > 0) alert(deps, "refused");
  const run = { batches: records.length, recorded, replays, refused };
  deps.logger.info(run, "payouts.payout_record.read");
  return run;
}

/** The first read of a Vietnam day is due from this time on. */
export const PAYOUT_RECORD_FROM: VnTimeOfDay = { hour: 9, minute: 30 };

/**
 * The hourly job, when the bridge of this start reads the payout record page (the real browser
 * only): from `PAYOUT_RECORD_FROM`, until one read of the Vietnam day succeeded.
 */
export function payoutRecordJobs(deps: PayoutRecordDeps): Job[] {
  if (deps.bridge.readPayoutRecords === undefined) return [];
  let doneFor: VnDate | null = null;
  const run = async (signal: AbortSignal): Promise<void> => {
    const now = deps.clock.now();
    const today = vnDateOf(now);
    const from = toMs(vnDayStart(today)) + (PAYOUT_RECORD_FROM.hour * 60 + PAYOUT_RECORD_FROM.minute) * 60_000;
    if (doneFor === today || toMs(now) < from) return;
    await runShopeePayoutRecords(deps, signal);
    doneFor = today;
  };
  return [{ name: "payoutRecords", ...JOB_SCHEDULES.payoutRecords, run }];
}
