/**
 * The payout history (FR-17, FR-34, FR-37, AD-12; Story 4.12): every payout ever recorded, voided
 * ones included, on the list contract, newest first. The paid summary is the SUM() of the stored
 * `paid_amount` (migration 0017: the transfer amount while RECORDED, 0 once VOIDED) over exactly
 * the filtered set, so it covers every payout, not the last 100 (list-defects Payments), and a
 * voided payout never counts as paid. The date filter is in Vietnam days and includes the whole
 * last day (AD-11). Search covers the customer's code and name (stored search_text).
 *
 * A customer's page lists the same rows scoped by the server to the customer's stored ids (Story
 * 4.14); `customerId` is not a URL filter, so the scope cannot be widened from the browser.
 */
import type { ListResponse, PayoutHistoryRow } from "@cashback/contracts";
import type { Clock } from "@cashback/core";
import { inArray, sql } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { defineList } from "../../platform/list/define-list";
import { answerList, answerScopedList } from "../../platform/list/list-request";
import { payouts } from "./schema";

export const PAYOUT_HISTORY_LIST = defineList({
  from: "payouts p JOIN customers c ON c.customer_id = p.customer_id",
  key: "p.payout_id",
  fields: {
    payoutId: { kind: "integer", column: "p.payout_id", sortable: true },
    customerId: { kind: "text", column: "p.customer_id" },
    customerCode: { kind: "text", column: "c.customer_code", sortable: true },
    customerName: { kind: "name", column: "c.display_name", sortKeyColumn: "c.sort_key", sortable: true },
    amount: { kind: "money", column: "p.transfer_amount", sortable: true },
    paidAmount: { kind: "money", column: "p.paid_amount", summary: true },
    status: { kind: "status", entity: "payout", column: "p.status", sortable: true, filter: true, facet: true },
    recordedAt: { kind: "instant", column: "p.recorded_at", sortable: true, filter: true },
    recordedBy: { kind: "text", column: "p.recorded_by", sortable: true },
    voidedAt: { kind: "instant", column: "p.voided_at" },
    receiptToken: { kind: "text", column: "p.receipt_token" },
  },
  search: ["c.search_text"],
  defaultSort: { field: "recordedAt", direction: "desc" },
});

export function answerPayoutHistory(db: LedgerDb, raw: unknown, clock: Clock): ListResponse<PayoutHistoryRow> {
  return answerList<typeof PAYOUT_HISTORY_LIST.fields, PayoutHistoryRow>(db, PAYOUT_HISTORY_LIST, raw, clock);
}

/** One customer's payouts, voided ones included (Story 4.14). */
export function answerCustomerPayouts(
  db: LedgerDb,
  customerIds: readonly string[],
  raw: unknown,
  clock: Clock,
): ListResponse<PayoutHistoryRow> {
  return answerScopedList<typeof PAYOUT_HISTORY_LIST.fields, PayoutHistoryRow>(
    db,
    PAYOUT_HISTORY_LIST,
    raw,
    clock,
    [{ field: "customerId", kind: "in", values: customerIds }],
  );
}

/** How many payouts, voided ones included, the stored ids hold together. */
export function payoutCountOf(db: LedgerDb, customerIds: readonly string[]): number {
  if (customerIds.length === 0) return 0;
  return (
    db
      .select({ count: sql<number>`count(*)` })
      .from(payouts)
      .where(inArray(payouts.customerId, [...customerIds]))
      .get()?.count ?? 0
  );
}
