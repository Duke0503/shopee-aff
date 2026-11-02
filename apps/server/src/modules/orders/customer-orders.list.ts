/**
 * The customer's own order lines on the website (FR-15, FR-37, AD-12, INV-5; Story 7.4): every
 * order, and every campaign bonus that counts (confirmed or paid) as its own row, so the rows
 * filtered to a state add up to the balance card (list-defects "balance cards include bonuses rows
 * never show"). The lines are one derived set read only (a `*.list.ts` may join, AD-4): a bonus
 * reads in the order vocabulary of the status registry, APPROVED while it waits to be paid, PAID
 * once paid and FROZEN while its order is being checked (D55), and carries its order's recorded
 * date, so the one date on a line is always the recorded one (list-defects `MyOrders.tsx` date
 * column). A held bonus is not listed: it may still lose its slot, and the card does not count it.
 * A paid order the network cancelled afterwards stays PAID in the ledger (D4) but reads as
 * REVERSED here, with its paid bonus, so the customer is not told it was paid and kept; an order
 * with an open clawback (cancelled, or paid less for after payout) carries what is deducted.
 *
 * Only the recorded date sorts; the amount is not sortable because a waiting order shows its
 * estimate, which is no stored column (LC-2). The estimate is `estimatedCashback` of packages/money,
 * the very function `getBalances` sums, and is shown only while the network has not decided (R4).
 * The scope is the session customer's stored ids, set by the server; `customerId` is no URL
 * filter, so the browser cannot widen it (Story 4.14).
 */
import type { ListResponse, MyOrderRow } from "@cashback/contracts";
import type { Clock } from "@cashback/core";
import { estimatedCashback } from "@cashback/money";

import type { LedgerDb } from "../../platform/db/ledger";
import { defineList } from "../../platform/list/define-list";
import { answerScopedList } from "../../platform/list/list-request";
import { httpsImageUrl } from "../linking/index";

/** A paid order the network cancelled afterwards (a full clawback, D4): it stays PAID in the ledger. */
const CANCELLED_AFTER_PAYOUT = "EXISTS (SELECT 1 FROM ledger_entries e WHERE e.order_id = o.order_id AND e.kind = 'CLAWBACK' AND e.reason = 'cancel_after_payout')";

const LINES = [
  `SELECT 'order' AS line_kind, o.order_id AS line_id, o.order_id, o.customer_id, o.network, o.platform, CASE WHEN o.status = 'PAID' AND ${CANCELLED_AFTER_PAYOUT} THEN 'REVERSED' ELSE o.status END AS status,`,
  "o.cashback, o.estimated_commission, o.rejection_reason, NULL AS campaign_name, o.recorded_at, o.approved_at, o.paid_at,",
  "o.request_id, o.search_text AS order_search_text FROM orders o",
  "UNION ALL",
  "SELECT 'bonus', 'bonus-' || a.award_id, a.order_id, a.customer_id, o.network, o.platform,",
  `CASE WHEN a.status = 'PAID' AND ${CANCELLED_AFTER_PAYOUT} THEN 'REVERSED' WHEN a.status = 'PAID' THEN 'PAID' WHEN o.status = 'FROZEN' THEN 'FROZEN' ELSE 'APPROVED' END,`,
  "a.amount, NULL, NULL, c.name, o.recorded_at, a.confirmed_at, a.paid_at, o.request_id, o.search_text",
  "FROM campaign_awards a JOIN campaigns c ON c.campaign_id = a.campaign_id LEFT JOIN orders o ON o.order_id = a.order_id",
  "WHERE a.status IN ('CONFIRMED', 'PAID')",
].join(" ");

export const CUSTOMER_ORDERS_LIST = defineList({
  from: `(${LINES}) m LEFT JOIN link_requests l ON l.request_id = m.request_id`,
  key: "m.line_id",
  fields: {
    lineId: { kind: "text", column: "m.line_id" },
    kind: { kind: "text", column: "m.line_kind" },
    orderId: { kind: "text", column: "m.order_id" },
    customerId: { kind: "text", column: "m.customer_id" },
    network: { kind: "text", column: "m.network" },
    platform: { kind: "text", column: "m.platform" },
    status: { kind: "status", entity: "order", column: "m.status", filter: true, facet: true },
    cashback: { kind: "money", column: "m.cashback" },
    estimatedCommission: { kind: "integer", column: "m.estimated_commission" },
    rejectionReason: { kind: "text", column: "m.rejection_reason" },
    campaignName: { kind: "text", column: "m.campaign_name" },
    productName: { kind: "text", column: "l.product_name" },
    productImageUrl: { kind: "text", column: "l.product_image_url" },
    recordedAt: { kind: "instant", column: "m.recorded_at", sortable: true },
    approvedAt: { kind: "instant", column: "m.approved_at" },
    paidAt: { kind: "instant", column: "m.paid_at" },
  },
  search: ["m.order_search_text", "l.search_text"],
  defaultSort: { field: "recordedAt", direction: "desc" },
  overallTotal: true,
});

interface Line {
  readonly lineId: string;
  readonly kind: "order" | "bonus";
  readonly orderId: string;
  readonly customerId: string;
  readonly network: "shopee" | "accesstrade" | null;
  readonly platform: string | null;
  readonly status: string;
  readonly cashback: number | null;
  readonly estimatedCommission: number | null;
  readonly rejectionReason: string | null;
  readonly campaignName: string | null;
  readonly productName: string | null;
  readonly productImageUrl: string | null;
  readonly recordedAt: string | null;
  readonly approvedAt: string | null;
  readonly paidAt: string | null;
}

/** The figure a line shows: the estimate while the network decides, the stored cashback once approved or paid, nothing otherwise. */
function amountOf(line: Line): Pick<MyOrderRow, "amount" | "estimate"> {
  if (line.status === "AWAITING_APPROVAL" && line.kind === "order") {
    return line.estimatedCommission === null ? { amount: null, estimate: true } : { amount: estimatedCashback(line.estimatedCommission, line.network), estimate: true };
  }
  if (line.status === "APPROVED" || line.status === "PAID") return { amount: line.cashback, estimate: false };
  return { amount: null, estimate: false };
}

function rowOf(line: Line, deductions: ReadonlyMap<string, number>): MyOrderRow {
  return {
    lineId: line.lineId,
    kind: line.kind,
    orderId: line.orderId,
    platform: line.platform,
    status: line.status,
    ...amountOf(line),
    rejectionReason: line.status === "REJECTED" ? line.rejectionReason : null,
    campaignName: line.campaignName,
    productName: line.productName,
    productImageUrl: httpsImageUrl(line.productImageUrl),
    recordedAt: line.recordedAt,
    approvedAt: line.approvedAt,
    paidAt: line.paidAt,
    deducted: line.kind === "order" ? (deductions.get(line.orderId) ?? null) : null,
  };
}

/**
 * One page of the order lines under the stored ids the server resolved for the session.
 * `deductions` is each clawed-back order's open clawback (payouts' own figure), shown on its line
 * whatever the line's state.
 */
export function answerMyOrders(db: LedgerDb, customerIds: readonly string[], raw: unknown, clock: Clock, deductions: ReadonlyMap<string, number>): ListResponse<MyOrderRow> {
  const page = answerScopedList<typeof CUSTOMER_ORDERS_LIST.fields, Line>(db, CUSTOMER_ORDERS_LIST, raw, clock, [{ field: "customerId", kind: "in", values: customerIds }]);
  return { ...page, rows: page.rows.map((line) => rowOf(line, deductions)) };
}
