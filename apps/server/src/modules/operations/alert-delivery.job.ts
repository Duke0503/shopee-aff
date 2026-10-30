/**
 * Delivering pending owner alerts (AD-27). Each pending alert is first marked SENDING under a
 * fresh attempt id in a transaction of its own, then sent outside any transaction, then its
 * outcome is written in another, so a slow or failing Telegram never holds the write lock.
 *
 * Once the sender accepted an alert it is never marked failed and never sent again: if writing
 * SENT fails, only that bookkeeping is retried, each failure logged; an alert left SENDING is
 * never picked up again. A failed send goes back to PENDING for the next run, up to
 * ALERT_MAX_ATTEMPTS. The log names the alert id and kind only.
 */
import { randomUUID } from "node:crypto";
import type { Clock } from "@cashback/core";

import type { Ledger } from "../../platform/db/ledger";
import type { Logger } from "../../platform/log/logger";
import { claimForSending, markAlertDelivery, pendingAlerts } from "./alert.command";
import { alertText } from "./domain/alert-cooldown";
import type { AlertSender } from "./telegram.adapter";

export interface DeliveryResult {
  sent: number;
  failed: number;
}

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
  const pending = ledger.tx((db) => pendingAlerts(db));
  const result: DeliveryResult = { sent: 0, failed: 0 };
  for (const alert of pending) {
    const attemptId = randomUUID();
    if (!ledger.tx((db) => claimForSending(db, alert.id, attemptId))) continue;
    try {
      await sender.send(alertText(alert));
    } catch (error) {
      recordFailed(ledger, alert, attemptId, clock, logger, error);
      result.failed++;
      continue;
    }
    result.sent++;
    recordSent(ledger, alert, attemptId, clock, logger);
  }
  if (pending.length > 0) logger.info({ ...result }, "operations.alert.delivered");
  return result;
}
