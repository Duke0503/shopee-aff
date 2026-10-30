/**
 * The review queue (FR-14, UJ-6, FR-37, AD-12; Story 4.15): every review case on the list
 * contract, oldest first, so the case that has waited longest is cleared first. The screen's two
 * tabs are `filter[status]` (open, resolved); the reason chips are the `reason` facet of the same
 * filtered set (LC-6), and the response also carries the whole count of open and of resolved
 * cases, each tab's own total. Search covers the subject and the order id (review_cases.search_text,
 * migration 0020), never the stored report row. Nothing here writes: apply and dismiss are the
 * Story 3.9 commands.
 */
import type { ReviewCaseList, ReviewCaseRow } from "@cashback/contracts";
import type { Clock } from "@cashback/core";
import { sql } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { defineList } from "../../platform/list/define-list";
import { answerList } from "../../platform/list/list-request";
import { reviewCases } from "./schema";

export const REVIEW_CASES_LIST = defineList({
  from: "review_cases r",
  key: "r.case_id",
  fields: {
    caseId: { kind: "integer", column: "r.case_id", sortable: true },
    network: { kind: "text", column: "r.network", sortable: true, filter: true, facet: true },
    subject: { kind: "text", column: "r.subject" },
    orderId: { kind: "text", column: "r.order_id", sortable: true },
    reason: { kind: "text", column: "r.reason", sortable: true, filter: true, facet: true },
    status: { kind: "status", entity: "reviewCase", column: "r.status", filter: true, facet: true },
    resolution: { kind: "text", column: "r.resolution", filter: true },
    openedAt: { kind: "instant", column: "r.opened_at", sortable: true, filter: true },
    resolvedAt: { kind: "instant", column: "r.resolved_at", sortable: true, filter: true },
  },
  search: ["r.search_text"],
  defaultSort: { field: "openedAt", direction: "asc" },
});

function statusCounts(db: LedgerDb): ReviewCaseList["counts"] {
  const rows = db
    .select({ status: reviewCases.status, count: sql<number>`count(*)` })
    .from(reviewCases)
    .groupBy(reviewCases.status)
    .all();
  const of = (status: string): number => rows.find((r) => r.status === status)?.count ?? 0;
  return { open: of("OPEN"), resolved: of("RESOLVED") };
}

/** One page of the review queue for a raw query, with both tabs' whole totals. */
export function answerReviewCases(db: LedgerDb, raw: unknown, clock: Clock): ReviewCaseList {
  return {
    ...answerList<typeof REVIEW_CASES_LIST.fields, ReviewCaseRow>(
      db,
      REVIEW_CASES_LIST,
      raw,
      clock,
    ),
    counts: statusCounts(db),
  };
}
