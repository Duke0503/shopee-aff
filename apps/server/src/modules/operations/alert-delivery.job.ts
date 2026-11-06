/**
 * Delivering pending owner alerts (AD-27). Each pending alert is first marked SENDING under a
 * fresh attempt id in a transaction of its own, then sent outside any transaction, then its
 * outcome is written in another, so a slow or failing Telegram never holds the write lock. The text
 * is rendered inside the claim's transaction (D65), so a retry reads the customer afresh and an
 * erased customer's name is never sent.
 *
 * Once the sender accepted an alert it is never marked failed and never sent again: if writing
 * SENT fails, only that bookkeeping is retried, each failure logged; an alert left SENDING is
 * never picked up again. A failed send goes back to PENDING for the next run, up to
 * ALERT_MAX_ATTEMPTS. The log names the alert id and kind only.
 *
 * Story 8.3: a pending alert raised more than 24 hours ago (a first deploy over an old ledger, a
 * long Telegram outage) is marked EXPIRED and never sent, counted in one log line per run; an
 * alert held until its cooldown ends waits; and one run sends at most ALERTS_PER_RUN, the rest
 * going out on the next runs, so the owner's chat is never flooded.
 *
 * D69: an alert whose condition has already ended (alert-ended.query.ts, read in the claim's
 * transaction) is marked EXPIRED and never sent, counted by kind in one log line per run.
 */
import { randomUUID } from "node:crypto";
import { instantFromMs, toMs, type Clock } from "@cashback/core";

import type { Ledger } from "../../platform/db/ledger";
import type { Logger } from "../../platform/log/logger";
import type { AlertPort } from "../../platform/ports/alert.port";
import { claimForSending, expireAlert, expireAlerts, markAlertDelivery, pendingAlerts } from "./alert.command";
import { alertConditionEnded } from "./alert-ended.query";
import { renderStoredAlert } from "./alert-render.query";
import { telegramText, type AlertSender } from "./telegram.adapter";

export interface DeliveryResult {
  sent: number;
  failed: number;
  /** Alerts older than ALERT_EXPIRY_MS skipped in this run, never sent. */
  expired?: number;
  /** Alerts whose condition had ended before they were due, never sent (D69). */
  dropped?: number;
}

/** A pending alert older than this is skipped, never sent. */
export const ALERT_EXPIRY_MS = 24 * 3_600_000;
/** The most alerts one delivery run sends. */
export const ALERTS_PER_RUN = 10;

/** Tries of the SENT bookkeeping after a successful send. */
export const BOOKKEEPING_ATTEMPTS = 3;

type DeliveryLogger = Pick<Logger, "info" | "warn">;

function recordSent(ledger: Pick<Ledger, "tx">, alert: { id: number; kind: string }, attemptId: string, clock: Clock, logger: DeliveryLogger): void {
  for (let attempt = 1; attempt <= BOOKKEEPING_ATTEMPTS; attempt++) {
    try {
      ledger.tx((db) => markAlertDelivery(db, alert.id, attemptId, "sent", clock.now()));
      return;
    } catch (error) {
      logger.warn({ alertId: alert.id, kind: alert.kind, attempt, error: error instanceof Error ? error.name : "unknown" }, "operations.alert.delivery_bookkeeping_failed");
    }
  }
}

function recordFailed(ledger: Pick<Ledger, "tx">, alert: { id: number; kind: string }, attemptId: string, clock: Clock, logger: DeliveryLogger, error: unknown): void {
  logger.warn({ alertId: alert.id, kind: alert.kind, error: error instanceof Error ? error.name : "unknown" }, "operations.alert.delivery_failed");
  try {
    ledger.tx((db) => markAlertDelivery(db, alert.id, attemptId, "failed", clock.now()));
  } catch (bookkeeping) {
    logger.warn({ alertId: alert.id, kind: alert.kind, error: bookkeeping instanceof Error ? bookkeeping.name : "unknown" }, "operations.alert.delivery_bookkeeping_failed");
  }
}

export async function deliverPendingAlerts(ledger: Pick<Ledger, "tx">, sender: AlertSender, clock: Clock, logger: DeliveryLogger): Promise<DeliveryResult> {
  const now = clock.now();
  const expired = ledger.tx((db) => expireAlerts(db, instantFromMs(toMs(now) - ALERT_EXPIRY_MS)));
  if (expired > 0) logger.warn({ expired }, "operations.alert.older_alerts_skipped");
  const pending = ledger.tx((db) => pendingAlerts(db, now)).slice(0, ALERTS_PER_RUN);
  const result: DeliveryResult = expired > 0 ? { sent: 0, failed: 0, expired } : { sent: 0, failed: 0 };
  const dropped: { id: number; kind: string }[] = [];
  for (const alert of pending) {
    const attemptId = randomUUID();
    const claim = ledger.tx((db) => {
      if (alertConditionEnded(db, alert)) return { dropped: expireAlert(db, alert.id), text: null };
      return { dropped: false, text: claimForSending(db, alert.id, attemptId) ? renderStoredAlert(db, alert) : null };
    });
    if (claim.dropped) dropped.push({ id: alert.id, kind: alert.kind });
    const text = claim.text;
    if (text === null) continue;
    try {
      await sender.send(text);
    } catch (error) {
      recordFailed(ledger, alert, attemptId, clock, logger, error);
      result.failed++;
      continue;
    }
    result.sent++;
    recordSent(ledger, alert, attemptId, clock, logger);
  }
  if (dropped.length > 0) {
    result.dropped = dropped.length;
    const byKind: Record<string, number> = {};
    for (const { kind } of dropped) byKind[kind] = (byKind[kind] ?? 0) + 1;
    logger.info({ dropped: byKind, alerts: dropped }, "operations.alert.ended_alerts_dropped");
  }
  if (pending.length > 0) logger.info({ ...result }, "operations.alert.delivered");
  return result;
}

/**
 * The alert port of a start that is failing (a pre-migration backup that failed its check, Story
 * 8.2): no scheduler will deliver a stored alert, so each alert is sent at once, and `settled`
 * waits for the sends before the process exits. A failed send is logged, never thrown.
 */
export function immediateAlerts(sender: AlertSender, logger: DeliveryLogger, clock: Clock): AlertPort & { settled(): Promise<void> } {
  const sends: Promise<void>[] = [];
  return {
    alert(kind, severity, detail) {
      logger.warn({ kind, severity, result: "immediate" }, "operations.alert.raised");
      sends.push(sender.send(telegramText({ kind, severity, suppressed: 0, raisedAt: clock.now(), detail: detail ?? null })).catch((error: unknown) => logger.warn({ kind, error: error instanceof Error ? error.name : "unknown" }, "operations.alert.delivery_failed")));
    },
    settled: async () => void (await Promise.all(sends)),
  };
}
