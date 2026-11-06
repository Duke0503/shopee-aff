/**
 * Delivering the daily link report to the DP Business group (D66). The job wakes every 5 minutes;
 * from 07:00 Vietnam time it reports yesterday (00:00 to 24:00 Vietnam time) until sent. The ledger,
 * not memory, says what was sent, so a restart repeats nothing and a server down at 07:00 reports at
 * its next run.
 *
 * The first attempt of a day renders the report and stores its messages with the row, so a retry
 * resumes the same text at the first unsent message. Sends happen outside any transaction, and each
 * accepted message is counted in its own. A failed send stops the run and raises an owner alert with
 * no personal data, under the kind's cooldown; the next run retries it. A send accepted just before
 * a crash, or whose count cannot be written, is sent once more: marking it before the send could lose
 * the report, and it must be retried until sent.
 *
 * Only the latest yesterday is ever sent: when a new day's report starts, an older one not sent in
 * full is dropped with its stored names, and days with no report at all are not made up. The log
 * carries counts, HTTP statuses and error names only.
 */
import { addVnDays, toMs, vnDateOf, vnDayStart, vnDaysBetween, type Clock, type VnDate, type VnTimeOfDay } from "@cashback/core";
import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";

import type { Ledger, LedgerDb } from "../../platform/db/ledger";
import type { Logger } from "../../platform/log/logger";
import type { AlertPort } from "../../platform/ports/alert.port";
import { dailyLinkReportOf } from "./daily-link-report.query";
import { dailyLinkReports } from "./schema";
import type { AlertSender } from "./telegram.adapter";

/** Yesterday's report is due from this Vietnam time on. */
export const DAILY_LINK_REPORT_FROM: VnTimeOfDay = { hour: 7, minute: 0 };

/** Told to the owner's chat when a send fails, so a report is not lost silently. */
export const DAILY_LINK_REPORT_FAILED_ALERT = { kind: "daily_link_report_failed", severity: "high" } as const;

/** Tries of writing how far a report was sent. */
const BOOKKEEPING_ATTEMPTS = 3;

type ReportLogger = Pick<Logger, "info" | "warn" | "error">;

export interface DailyLinkReportRun {
  readonly sent: number;
  readonly failed: number;
}

interface DueReport {
  readonly parts: readonly string[];
  readonly partsSent: number;
}

const errorName = (error: unknown): string => (error instanceof Error ? error.name : "unknown");

/** The HTTP status a failed send carries, read structurally. */
function httpStatus(error: unknown): { status: number } | Record<string, never> {
  const status = typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
  return typeof status === "number" ? { status } : {};
}

/** Older days not sent: their stored names go, and they are counted with the days that have no row. */
function dropEarlierDays(db: LedgerDb, date: VnDate, logger: ReportLogger): void {
  const latest = db.select({ date: sql<VnDate | null>`max(${dailyLinkReports.reportDate})` }).from(dailyLinkReports).get()?.date ?? null;
  const missed = latest === null ? 0 : Math.max(vnDaysBetween(latest, date) - 2, 0);
  const unsent = db.update(dailyLinkReports).set({ parts: null }).where(and(lt(dailyLinkReports.reportDate, date), isNull(dailyLinkReports.sentAt), isNotNull(dailyLinkReports.parts))).run().changes;
  if (missed + unsent > 0) logger.warn({ unsent, missed }, "operations.daily_link_report.earlier_days_skipped");
}

/** What is left to send of a day's report, written on its first attempt; null once it is sent. */
function dueReport(db: LedgerDb, date: VnDate, logger: ReportLogger): DueReport | null {
  const row = db.select().from(dailyLinkReports).where(eq(dailyLinkReports.reportDate, date)).get();
  if (row !== undefined) return row.sentAt !== null || row.parts === null ? null : { parts: JSON.parse(row.parts) as string[], partsSent: row.partsSent };
  dropEarlierDays(db, date, logger);
  const { parts, customers, requests } = dailyLinkReportOf(db, date);
  db.insert(dailyLinkReports).values({ reportDate: date, parts: JSON.stringify(parts) }).run();
  logger.info({ customers, requests, parts: parts.length }, "operations.daily_link_report.written");
  return { parts, partsSent: 0 };
}

/** Writes how far the report went, with retries; false when it could not, so nothing further is sent on a stale count. */
function record(ledger: Pick<Ledger, "tx">, clock: Clock, logger: ReportLogger, date: VnDate, partsSent: number, total: number): boolean {
  const progress = partsSent === total ? { partsSent, parts: null, sentAt: clock.now() } : { partsSent };
  for (let attempt = 1; attempt <= BOOKKEEPING_ATTEMPTS; attempt++) {
    try {
      ledger.tx((db) => db.update(dailyLinkReports).set(progress).where(eq(dailyLinkReports.reportDate, date)).run());
      return true;
    } catch (error) {
      logger.warn({ attempt, error: errorName(error) }, "operations.daily_link_report.bookkeeping_failed");
    }
  }
  logger.error({ partsSent, total }, "operations.daily_link_report.bookkeeping_lost");
  return false;
}

/** One run: nothing before 07:00 or once the day is sent, else the unsent messages in order. */
export async function deliverDailyLinkReport(ledger: Pick<Ledger, "tx">, sender: AlertSender, clock: Clock, logger: ReportLogger, alerts: AlertPort): Promise<DailyLinkReportRun> {
  const now = clock.now();
  const today = vnDateOf(now);
  const from = toMs(vnDayStart(today)) + (DAILY_LINK_REPORT_FROM.hour * 60 + DAILY_LINK_REPORT_FROM.minute) * 60_000;
  if (toMs(now) < from) return { sent: 0, failed: 0 };
  const date = addVnDays(today, -1);
  const due = ledger.tx((db) => dueReport(db, date, logger));
  if (due === null) return { sent: 0, failed: 0 };
  let sent = 0;
  for (const [index, part] of due.parts.entries()) {
    if (index < due.partsSent) continue;
    try {
      await sender.send(part);
    } catch (error) {
      logger.warn({ partsSent: index, total: due.parts.length, error: errorName(error), ...httpStatus(error) }, "operations.daily_link_report.delivery_failed");
      alerts.alert(DAILY_LINK_REPORT_FAILED_ALERT.kind, DAILY_LINK_REPORT_FAILED_ALERT.severity);
      return { sent, failed: 1 };
    }
    sent++;
    if (!record(ledger, clock, logger, date, index + 1, due.parts.length)) return { sent, failed: 0 };
  }
  logger.info({ sent, total: due.parts.length }, "operations.daily_link_report.delivered");
  return { sent, failed: 0 };
}
