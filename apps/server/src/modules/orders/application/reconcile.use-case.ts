import type { Db } from "../../../shared/database/connection";
import type { AttributionLookups } from "../domain/attribution";
import { decideReconcile, type ReportRow, type ReportStatus } from "../domain/reconcile";
import type { OrderRef, OrderStatus } from "../domain/order";
import { findOrder, markApproved, markRejected, recordOrder } from "../infrastructure/order.repository";
import { flagForReview } from "../infrastructure/manual-review.repository";
import { logRun } from "../infrastructure/reconciliation-run.repository";

/**
 * Walk one platform report and apply every decision. This is the job that
 * runs on a timer and looks back 90 days, so it sees the same order many
 * times on purpose — the `paid_at` guard makes that safe.
 */
export interface ReportRowInput extends ReportRow {
  orderId: string;
  orderValueVnd: number;
  recordedAt: string | null;
  platform: string;
}

export interface ReconcileInput {
  source: string;
  nowIso: string;
  rows: ReportRowInput[];
  lookups: AttributionLookups;
  /** Approved commission -> the customer's cashback (from packages/money). */
  cashbackFor: (approvedCommission: number) => number;
}

export interface ReconcileSummary {
  rowsRead: number;
  ordersNew: number;
  approved: number;
  rejected: number;
  skipped: number;
  needsReview: number;
}

export function reconcileReport(db: Db, input: ReconcileInput): ReconcileSummary {
  const summary: ReconcileSummary = {
    rowsRead: input.rows.length,
    ordersNew: 0,
    approved: 0,
    rejected: 0,
    skipped: 0,
    needsReview: 0,
  };

  for (const row of input.rows) {
    const found = findOrder(db, row.orderId);
    const existing: OrderRef | null = found
      ? { status: found.status as OrderStatus, paidAt: found.paidAt }
      : null;
    const decision = decideReconcile(
      {
        subId1: row.subId1,
        subId2: row.subId2,
        status: row.status as ReportStatus,
        approvedCommission: row.approvedCommission,
      },
      existing,
      input.lookups,
    );

    switch (decision.kind) {
      case "record":
        recordOrder(db, {
          orderId: row.orderId,
          customerId: decision.customerId,
          requestId: row.subId2,
          orderValue: row.orderValueVnd,
          estimatedCommission: row.approvedCommission,
          recordedAt: row.recordedAt ?? input.nowIso,
          platform: row.platform,
          nowIso: input.nowIso,
        });
        summary.ordersNew += 1;
        break;
      case "approve":
        markApproved(db, row.orderId, row.approvedCommission ?? 0, input.cashbackFor(row.approvedCommission ?? 0), input.nowIso);
        summary.approved += 1;
        break;
      case "reject":
        markRejected(db, row.orderId, "rejected by the platform report", input.nowIso);
        summary.rejected += 1;
        break;
      case "review":
        if (flagForReview(db, { orderId: row.orderId, rawData: JSON.stringify(row), reason: decision.reason, createdAt: input.nowIso })) {
          summary.needsReview += 1;
        }
        break;
      default:
        summary.skipped += 1;
    }
  }

  logRun(db, { ranAt: input.nowIso, source: input.source, periodStart: null, periodEnd: null, error: null, ...summary });
  return summary;
}
