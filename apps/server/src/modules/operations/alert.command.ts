/**
 * `alert(kind, severity)` (AD-27, FR-30): stores an owner alert for the sender to deliver, with
 * the per-severity cooldown. Raised again inside the cooldown of the last alert of the same kind
 * and severity while that alert is still PENDING, it is counted on it as suppressed; once the last
 * one is being sent, sent or given up, a repeat is a new alert, so a FAILED critical alert never
 * silences the next. Inside a command it goes through that command's transaction handle
 * (`alertsFor`); a job outside any transaction uses `ledgerAlerts`, which opens its own. Every
 * raise is also a log line.
 *
 * Delivery bookkeeping: `claimForSending` marks a PENDING alert SENDING under a fresh attempt id
 * before the send; `markAlertDelivery` then records the outcome of that attempt only.
 */
import { toMs, type Clock, type Instant } from "@cashback/core";
import { and, desc, eq, sql } from "drizzle-orm";

import type { Ledger, LedgerDb } from "../../platform/db/ledger";
import type { Logger } from "../../platform/log/logger";
import { ALERT_SEVERITIES, type AlertPort, type AlertSeverity } from "../../platform/ports/alert.port";
import { ALERT_KIND, insideCooldown } from "./domain/alert-cooldown";
import { alerts, type AlertRow } from "./schema";

export type AlertOutcome = { readonly result: "pending" | "suppressed"; readonly id: number };

export function raiseAlert(db: LedgerDb, clock: Clock, kind: string, severity: AlertSeverity): AlertOutcome {
  if (!ALERT_KIND.test(kind)) throw new RangeError(`not an alert kind: ${kind}`);
  if (!(ALERT_SEVERITIES as readonly string[]).includes(severity)) throw new RangeError(`not an alert severity: ${String(severity)}`);
  const now = clock.now();
  const last = db
    .select({ id: alerts.id, raisedAt: alerts.raisedAt, delivery: alerts.delivery })
    .from(alerts)
    .where(and(eq(alerts.kind, kind), eq(alerts.severity, severity)))
    .orderBy(desc(alerts.raisedAt), desc(alerts.id))
    .limit(1)
    .get();
  if (last && last.delivery === "PENDING" && insideCooldown(severity, toMs(now) - toMs(last.raisedAt as Instant))) {
    db.update(alerts)
      .set({ suppressed: sql`${alerts.suppressed} + 1` })
      .where(eq(alerts.id, last.id))
      .run();
    return { result: "suppressed", id: last.id };
  }
  const row = db.insert(alerts).values({ kind, severity, raisedAt: now, delivery: "PENDING" }).returning({ id: alerts.id }).get();
  return { result: "pending", id: row.id };
}

type AlertLogger = Pick<Logger, "warn">;

/** The alert port bound to one transaction's handle. */
export function alertsFor(db: LedgerDb, clock: Clock, logger?: AlertLogger): AlertPort & { alert(kind: string, severity: AlertSeverity): AlertOutcome } {
  return {
    alert: (kind, severity) => {
      const outcome = raiseAlert(db, clock, kind, severity);
      logger?.warn({ kind, severity, result: outcome.result }, "operations.alert.raised");
      return outcome;
    },
  };
}

/** The alert port for code outside a transaction (jobs): each alert is its own `tx`. */
export function ledgerAlerts(ledger: Ledger, clock: Clock, logger?: AlertLogger): AlertPort {
  return { alert: (kind, severity) => void ledger.tx((db) => alertsFor(db, clock, logger).alert(kind, severity)) };
}

export function pendingAlerts(db: LedgerDb): AlertRow[] {
  return db.select().from(alerts).where(eq(alerts.delivery, "PENDING")).orderBy(alerts.id).all();
}

/** Attempts before a pending alert is given up as FAILED. */
export const ALERT_MAX_ATTEMPTS = 5;

/** Marks a PENDING alert SENDING under `attemptId`; false when it is no longer pending. */
export function claimForSending(db: LedgerDb, id: number, attemptId: string): boolean {
  const result = db
    .update(alerts)
    .set({ delivery: "SENDING", sendAttempt: attemptId, attempts: sql`${alerts.attempts} + 1` })
    .where(and(eq(alerts.id, id), eq(alerts.delivery, "PENDING")))
    .run();
  return result.changes === 1;
}

/** Records the outcome of one send attempt; a stale attempt id changes nothing. */
export function markAlertDelivery(db: LedgerDb, id: number, attemptId: string, outcome: "sent" | "failed", at: Instant): void {
  const thisAttempt = and(eq(alerts.id, id), eq(alerts.delivery, "SENDING"), eq(alerts.sendAttempt, attemptId));
  if (outcome === "sent") {
    db.update(alerts).set({ delivery: "SENT", deliveredAt: at }).where(thisAttempt).run();
    return;
  }
  const delivery = sql`CASE WHEN ${alerts.attempts} >= ${ALERT_MAX_ATTEMPTS} THEN ${"FAILED"} ELSE ${"PENDING"} END`;
  db.update(alerts).set({ delivery }).where(thisAttempt).run();
}
