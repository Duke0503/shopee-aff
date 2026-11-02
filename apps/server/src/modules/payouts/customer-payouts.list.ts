/**
 * The customer's own payouts on the website (FR-15, FR-17, FR-18, AD-12, INV-5, INV-13; Story 7.4):
 * every payout recorded for the session customer's stored ids, voided ones included, newest first.
 * `paidAmount` (the transfer while recorded, 0 once voided, migration 0017) is what `getBalances`
 * sums as paid, so the summary over the scope equals the card's "paid" figure. A row says only
 * whether a proof image exists; the image itself is fetched from the owner-only proof route
 * (Story 4.9), never named here. Nothing about the staff member who recorded it is sent.
 */
import type { ListResponse, MyPayoutRow } from "@cashback/contracts";
import type { Clock } from "@cashback/core";

import type { LedgerDb } from "../../platform/db/ledger";
import { defineList } from "../../platform/list/define-list";
import { answerScopedList } from "../../platform/list/list-request";

export const CUSTOMER_PAYOUTS_LIST = defineList({
  from: "payouts p LEFT JOIN payout_proofs pp ON pp.payout_id = p.payout_id",
  key: "p.payout_id",
  fields: {
    payoutId: { kind: "integer", column: "p.payout_id" },
    customerId: { kind: "text", column: "p.customer_id" },
    amount: { kind: "money", column: "p.transfer_amount" },
    paidAmount: { kind: "money", column: "p.paid_amount", summary: true },
    status: { kind: "status", entity: "payout", column: "p.status" },
    recordedAt: { kind: "instant", column: "p.recorded_at", sortable: true },
    voidedAt: { kind: "instant", column: "p.voided_at" },
    receiptToken: { kind: "text", column: "p.receipt_token" },
    proofOf: { kind: "integer", column: "pp.payout_id" },
  },
  search: [],
  defaultSort: { field: "recordedAt", direction: "desc" },
  overallTotal: true,
});

type Row = Omit<MyPayoutRow, "hasProof"> & { readonly customerId: string; readonly proofOf: number | null };

/** One page of the session customer's payouts, under the stored ids the server resolved. */
export function answerMyPayouts(db: LedgerDb, customerIds: readonly string[], raw: unknown, clock: Clock): ListResponse<MyPayoutRow> {
  const page = answerScopedList<typeof CUSTOMER_PAYOUTS_LIST.fields, Row>(db, CUSTOMER_PAYOUTS_LIST, raw, clock, [{ field: "customerId", kind: "in", values: customerIds }]);
  return { ...page, rows: page.rows.map(({ customerId: _owner, proofOf, ...row }) => ({ ...row, hasProof: proofOf !== null })) };
}
