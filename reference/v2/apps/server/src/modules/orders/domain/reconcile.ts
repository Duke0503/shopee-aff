import { attributeOrder, type AttributionLookups } from "./attribution";
import { APPROVED, canApprove, isFinal, type OrderRef } from "./order";

/**
 * What to do with one row of a platform report. Ports the decision in
 * `reconcile.use-case.ts` / `shopee/reconciliation.py`, and reuses the pieces
 * that already exist: attribution (never guess), the `paid_at` guard (never
 * pay twice), and "approval needs a commission figure".
 */
export type ReportStatus = "awaiting_approval" | "approved" | "rejected" | "unknown";

export interface ReportRow {
  subId1: string | null;
  subId2: string | null;
  status: ReportStatus;
  approvedCommission: number | null;
}

export type ReconcileOutcome =
  | { kind: "skip"; reason: string }
  | { kind: "review"; reason: string }
  | { kind: "record"; customerId: string }
  | { kind: "approve"; customerId: string }
  | { kind: "reject"; customerId: string };

export function decideReconcile(
  row: ReportRow,
  existing: OrderRef | null,
  lookups: AttributionLookups,
): ReconcileOutcome {
  // Rule 2: an order that is paid (or rejected) is never touched again.
  if (existing && isFinal(existing)) {
    return { kind: "skip", reason: "order is already final" };
  }
  if (row.status === "unknown") {
    return { kind: "review", reason: "unknown status in the report" };
  }

  const attribution = attributeOrder({ subId1: row.subId1, subId2: row.subId2 }, lookups);
  if (!attribution.customerId) {
    return { kind: "review", reason: attribution.reason ?? "no customer matched" };
  }
  const customerId = attribution.customerId;

  if (!existing) return { kind: "record", customerId };

  if (row.status === "approved") {
    if (existing.status === APPROVED) return { kind: "skip", reason: "already approved" };
    if (!canApprove(row.approvedCommission)) {
      return { kind: "review", reason: "approved without a commission figure" };
    }
    return { kind: "approve", customerId };
  }
  if (row.status === "rejected") {
    // An approved order stays approved, whatever the report now says.
    if (existing.status === APPROVED) return { kind: "skip", reason: "approved stays approved" };
    return { kind: "reject", customerId };
  }
  return { kind: "skip", reason: "still awaiting approval" };
}
