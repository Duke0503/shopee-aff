/**
 * `alert(kind, severity)` (AD-27, FR-30): stores an owner alert for the sender to deliver, with
 * the per-severity cooldown. Raised again inside the cooldown of the last alert of the same kind
 * and severity:
 * - while that alert still waits or is being sent, the repeat is counted on it as suppressed;
 * - once it was sent, the repeat is a new alert held until the cooldown ends (`not_before`), and
 *   later repeats count on that one, so a second outage inside the cooldown is still told, once,
 *   with its repeat count (Story 8.3: 3 critical alerts in 4 minutes are one Telegram message
 *   inside the cooldown);
 * - a last alert given up as FAILED or skipped as EXPIRED lets the repeat through at once.
 *
 * A repeat counted on an alert leaves that alert's detail alone, so the first detail of a cooldown
 * is the one told (D65). `raiseKeyedAlert` stands outside all this: one alert per key, never
 * repeated, whatever the kind's cooldown says. Inside a command it goes through that command's transaction handle
 * (`alertsFor`); a job outside any transaction uses `ledgerAlerts`, which opens its own. Every
 * raise is also a log line.
 *
 * Delivery bookkeeping: `claimForSending` marks a PENDING alert SENDING under a fresh attempt id
 * before the send; `markAlertDelivery` then records the outcome of that attempt only.
 */
import { instantFromMs, toMs, type Clock, type Instant } from "@cashback/core";
import { and, desc, eq, isNull, lte, or, sql } from "drizzle-orm";

import type { Ledger, LedgerDb } from "../../platform/db/ledger";
import type { Logger } from "../../platform/log/logger";
import { ALERT_SEVERITIES, ALERT_SOURCES, type AlertDetail, type AlertPort, type AlertSeverity } from "../../platform/ports/alert.port";
import { ALERT_COOLDOWN_MS, ALERT_KIND, insideCooldown } from "./domain/alert-cooldown";
import { alerts, type AlertRow } from "./schema";

export type AlertOutcome = { readonly result: "pending" | "suppressed"; readonly id: number };

const REQUEST_ID = /^[A-Za-z0-9]{1,64}$/;

/** Refuses free text, so no personal data reaches the table through a kind or a detail. */
function checkAlert(kind: string, severity: AlertSeverity, detail: AlertDetail | undefined): void {
  if (!ALERT_KIND.test(kind)) throw new RangeError(`not an alert kind: ${kind}`);
  if (!(ALERT_SEVERITIES as readonly string[]).includes(severity)) throw new RangeError(`not an alert severity: ${String(severity)}`);
  if (detail === undefined) return;
  if (!(ALERT_SOURCES as readonly string[]).includes(detail.source)) throw new RangeError("not an alert source");
  if (detail.requestId !== undefined && !REQUEST_ID.test(detail.requestId)) throw new RangeError("not a request id");
}

const storedDetail = (detail: AlertDetail | undefined): string | null => (detail === undefined ? null : JSON.stringify(detail));

export function raiseAlert(db: LedgerDb, clock: Clock, kind: string, severity: AlertSeverity, detail?: AlertDetail): AlertOutcome {
  checkAlert(kind, severity, detail);
  const now = clock.now();
  const last = db
    .select({ id: alerts.id, raisedAt: alerts.raisedAt, delivery: alerts.delivery })
    .from(alerts)
    .where(and(eq(alerts.kind, kind), eq(alerts.severity, severity)))
    .orderBy(desc(alerts.raisedAt), desc(alerts.id))
    .limit(1)
    .get();
  const inside = last !== undefined && insideCooldown(severity, toMs(now) - toMs(last.raisedAt as Instant));
  if (inside && (last.delivery === "PENDING" || last.delivery === "SENDING")) {
    db.update(alerts)
      .set({ suppressed: sql`${alerts.suppressed} + 1` })
      .where(eq(alerts.id, last.id))
      .run();
    return { result: "suppressed", id: last.id };
  }
  const notBefore = inside && last.delivery === "SENT" ? instantFromMs(toMs(last.raisedAt as Instant) + ALERT_COOLDOWN_MS[severity]) : null;
  const row = db.insert(alerts).values({ kind, severity, raisedAt: now, delivery: "PENDING", notBefore, detail: storedDetail(detail) }).returning({ id: alerts.id }).get();
  return { result: "pending", id: row.id };
}

export interface KeyedAlert {
  readonly kind: string;
  readonly severity: AlertSeverity;
  readonly dedupKey: string;
  readonly detail: AlertDetail;
}

/** Stores the alert of this key unless it has one already; true when it did. Never counted, never held by a cooldown. */
export function raiseKeyedAlert(db: LedgerDb, clock: Clock, alert: KeyedAlert): boolean {
  checkAlert(alert.kind, alert.severity, alert.detail);
  return db.insert(alerts).values({ kind: alert.kind, severity: alert.severity, raisedAt: clock.now(), delivery: "PENDING", detail: storedDetail(alert.detail), dedupKey: alert.dedupKey }).onConflictDoNothing().run().changes === 1;
}

type AlertLogger = Pick<Logger, "warn">;

/** The alert port bound to one transaction's handle. */
export function alertsFor(db: LedgerDb, clock: Clock, logger?: AlertLogger): AlertPort & { alert(kind: string, severity: AlertSeverity, detail?: AlertDetail): AlertOutcome } {
  return {
    alert: (kind, severity, detail) => {
      const outcome = raiseAlert(db, clock, kind, severity, detail);
      logger?.warn({ kind, severity, result: outcome.result }, "operations.alert.raised");
      return outcome;
    },
  };
}

/** The alert port for code outside a transaction (jobs): each alert is its own `tx`. */
export function ledgerAlerts(ledger: Ledger, clock: Clock, logger?: AlertLogger): AlertPort {
  return { alert: (kind, severity, detail) => void ledger.tx((db) => alertsFor(db, clock, logger).alert(kind, severity, detail)) };
}

/** Pending alerts due at `now` (all pending ones without `now`), oldest first. */
export function pendingAlerts(db: LedgerDb, now?: Instant): AlertRow[] {
  const due = now === undefined ? undefined : or(isNull(alerts.notBefore), lte(alerts.notBefore, now));
  return db.select().from(alerts).where(and(eq(alerts.delivery, "PENDING"), due)).orderBy(alerts.id).all();
}

/** Marks pending alerts raised before `before` EXPIRED, never to be sent; returns how many. */
export function expireAlerts(db: LedgerDb, before: Instant): number {
  return db
    .update(alerts)
    .set({ delivery: "EXPIRED" })
    .where(and(eq(alerts.delivery, "PENDING"), sql`${alerts.raisedAt} < ${before}`))
    .run().changes;
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
