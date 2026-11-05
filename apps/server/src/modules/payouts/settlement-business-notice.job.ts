/**
 * Delivering the Telegram settlement notices to the DP Business group (D63), under the delivery
 * rules of the order notices (D62, orders/order-business-notice.job.ts). Each pending notice is
 * marked SENDING under a fresh attempt id and rendered in one transaction, sent outside any
 * transaction, and its outcome written in another, so a slow or failing Telegram never holds the
 * write lock.
 *
 * Once the sender accepted a notice it is never sent again: if writing SENT fails, only that
 * bookkeeping is retried, and a notice left SENDING is never picked up again. A failed send goes
 * back to PENDING and stops the run, so notices keep their order; the next run retries it. A notice
 * still pending 24 hours after its change is marked EXPIRED and never sent, counted in one log line.
 * One run sends at most NOTICES_PER_RUN. The log names notice ids, events and HTTP statuses only.
 */
import { randomUUID } from "node:crypto";
import { instantFromMs, toMs, type Clock, type Instant } from "@cashback/core";
import { and, asc, eq, lt, sql } from "drizzle-orm";

import type { Ledger, LedgerDb } from "../../platform/db/ledger";
import type { Logger } from "../../platform/log/logger";
import { NOTICE_EXPIRY_MS, NOTICES_PER_RUN, type BusinessNoticeRun, type BusinessNoticeSender } from "../orders/index";
import { settlementBusinessNotices } from "./schema";
import { renderSettlementNotice } from "./settlement-business-notice.query";

/** Tries of writing a send's outcome. */
const BOOKKEEPING_ATTEMPTS = 3;

type NoticeLogger = Pick<Logger, "info" | "warn">;
type NoticeOutcome = { delivery: "SENT"; deliveredAt: Instant } | { delivery: "PENDING" };

const errorName = (error: unknown): string => (error instanceof Error ? error.name : "unknown");

/** The HTTP status a failed send carries, read structurally: it tells a permanent refusal from a rate limit. */
function httpStatus(error: unknown): { status: number } | Record<string, never> {
  const status = typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
  return typeof status === "number" ? { status } : {};
}

function expireNotices(db: LedgerDb, before: Instant): number {
  return db
    .update(settlementBusinessNotices)
    .set({ delivery: "EXPIRED" })
    .where(and(eq(settlementBusinessNotices.delivery, "PENDING"), lt(settlementBusinessNotices.raisedAt, before)))
    .run().changes;
}

function claim(db: LedgerDb, id: number, attemptId: string): boolean {
  const claimed = db
    .update(settlementBusinessNotices)
    .set({ delivery: "SENDING", sendAttempt: attemptId, attempts: sql`${settlementBusinessNotices.attempts} + 1` })
    .where(and(eq(settlementBusinessNotices.id, id), eq(settlementBusinessNotices.delivery, "PENDING")))
    .run();
  return claimed.changes === 1;
}

/** Writes the outcome of this attempt only, with retries: a lost SENT never resends, a lost PENDING would lose the notice. */
function record(ledger: Pick<Ledger, "tx">, logger: NoticeLogger, notice: { id: number; event: string }, attemptId: string, outcome: NoticeOutcome): void {
  const thisAttempt = and(eq(settlementBusinessNotices.id, notice.id), eq(settlementBusinessNotices.delivery, "SENDING"), eq(settlementBusinessNotices.sendAttempt, attemptId));
  for (let attempt = 1; attempt <= BOOKKEEPING_ATTEMPTS; attempt++) {
    try {
      ledger.tx((db) => db.update(settlementBusinessNotices).set(outcome).where(thisAttempt).run());
      return;
    } catch (error) {
      logger.warn({ noticeId: notice.id, event: notice.event, attempt, error: errorName(error) }, "payouts.settlement_notice.bookkeeping_failed");
    }
  }
}

export async function deliverSettlementNotices(ledger: Pick<Ledger, "tx">, sender: BusinessNoticeSender, clock: Clock, logger: NoticeLogger): Promise<BusinessNoticeRun> {
  const expired = ledger.tx((db) => expireNotices(db, instantFromMs(toMs(clock.now()) - NOTICE_EXPIRY_MS)));
  if (expired > 0) logger.warn({ expired }, "payouts.settlement_notice.older_notices_skipped");
  const pending = ledger.tx((db) => db.select().from(settlementBusinessNotices).where(eq(settlementBusinessNotices.delivery, "PENDING")).orderBy(asc(settlementBusinessNotices.id)).limit(NOTICES_PER_RUN).all());
  const run: BusinessNoticeRun = { sent: 0, failed: 0, expired };
  for (const notice of pending) {
    const attemptId = randomUUID();
    const text = ledger.tx((db) => (claim(db, notice.id, attemptId) ? renderSettlementNotice(db, notice) : null));
    if (text === null) continue;
    try {
      await sender.send(text);
    } catch (error) {
      logger.warn({ noticeId: notice.id, event: notice.event, error: errorName(error), ...httpStatus(error) }, "payouts.settlement_notice.delivery_failed");
      record(ledger, logger, notice, attemptId, { delivery: "PENDING" });
      run.failed++;
      break;
    }
    run.sent++;
    record(ledger, logger, notice, attemptId, { delivery: "SENT", deliveredAt: clock.now() });
  }
  if (pending.length > 0) logger.info({ ...run }, "payouts.settlement_notice.delivered");
  return run;
}
