/**
 * The network payouts tab of Payouts (FR-19, FR-37, D59, Story 4.21) and one payout's detail.
 *
 * The list is on the list contract: one row per batch with its network, payout id, status, what
 * the match did, its gross, withholding, fee and tax, what was received, the gross of the
 * operator's matched orders and the unattributed rest, and how many orders it covers (settled, or
 * proposed for a mismatch), all stored values; the summary sums them over the filtered set. The
 * detail lists each order with its customer, product snapshot (D56), gross and what the network
 * pays for it, and the open review cases; the screen computes nothing.
 */
import type { ListResponse, NetworkSettlementDetail, NetworkSettlementRow } from "@cashback/contracts";
import type { Clock } from "@cashback/core";
import { eq } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { defineList } from "../../platform/list/define-list";
import { answerList } from "../../platform/list/list-request";
import { openSettlementCaseIds, orderCardsOf } from "../orders/index";
import { networkSettlementOrders, networkSettlements } from "./schema";

export const NETWORK_SETTLEMENT_LIST = defineList({
  from: "network_settlements n LEFT JOIN (SELECT settlement_id, COUNT(*) AS order_count FROM network_settlement_orders WHERE outcome IN ('SETTLED', 'CANDIDATE') GROUP BY settlement_id) k ON k.settlement_id = n.settlement_id",
  key: "n.settlement_id",
  fields: {
    settlementId: { kind: "integer", column: "n.settlement_id" },
    network: { kind: "text", column: "n.network", sortable: true, filter: true, facet: true },
    networkPayoutId: { kind: "text", column: "n.network_payout_id", sortable: true },
    status: { kind: "status", entity: "networkSettlement", column: "n.status", sortable: true, filter: true, facet: true },
    match: { kind: "text", column: "n.match", filter: true, facet: true },
    amount: { kind: "money", column: "n.amount", sortable: true, summary: true },
    eligibleAmount: { kind: "money", column: "n.eligible_amount", sortable: true, summary: true },
    withheld: { kind: "integer", column: "n.withheld" },
    fee: { kind: "money", column: "n.fee", summary: true },
    tax: { kind: "money", column: "n.tax", summary: true },
    matchedGross: { kind: "money", column: "n.matched_gross", sortable: true, summary: true },
    unattributed: { kind: "integer", column: "n.unattributed", sortable: true },
    orderCount: { kind: "integer", column: "k.order_count", sortable: true },
    createdAt: { kind: "instant", column: "n.created_at", sortable: true, filter: true },
    paidAt: { kind: "instant", column: "n.paid_at", sortable: true },
  },
  search: ["n.search_text"],
  defaultSort: { field: "createdAt", direction: "desc" },
});

type Row = Omit<NetworkSettlementRow, "orderCount" | "withheld"> & { orderCount: number | null; withheld: number | null };

const rowOf = (r: Row): NetworkSettlementRow => ({ ...r, orderCount: r.orderCount ?? 0, withheld: r.withheld === null ? null : r.withheld === 1 });

export function answerNetworkSettlements(db: LedgerDb, raw: unknown, clock: Clock): ListResponse<NetworkSettlementRow> {
  const page = answerList<typeof NETWORK_SETTLEMENT_LIST.fields, Row>(db, NETWORK_SETTLEMENT_LIST, raw, clock);
  return { ...page, rows: page.rows.map(rowOf) };
}

const ORDER_RANK = { SETTLED: 0, CANDIDATE: 1, CONFLICT: 2, NOT_APPROVED: 3, UNKNOWN: 4 } as const;

/** One network batch with its orders, or null when there is none. */
export function networkSettlementDetail(db: LedgerDb, settlementId: number): NetworkSettlementDetail | null {
  const s = db.select().from(networkSettlements).where(eq(networkSettlements.settlementId, settlementId)).get();
  if (s === undefined) return null;
  const lines = db.select().from(networkSettlementOrders).where(eq(networkSettlementOrders.settlementId, settlementId)).all();
  lines.sort((a, b) => ORDER_RANK[a.outcome] - ORDER_RANK[b.outcome] || a.orderId.localeCompare(b.orderId));
  const cards = orderCardsOf(db, lines.map((l) => l.orderId));
  const orders = lines.map((l) => {
    const card = cards.get(l.orderId);
    return {
      orderId: l.orderId,
      outcome: l.outcome,
      gross: l.gross,
      net: l.net,
      customerCode: card?.customerCode ?? null,
      customerName: card?.customerName ?? null,
      productName: card?.productName ?? null,
      productImageUrl: card?.productImageUrl ?? null,
      status: card?.status ?? null,
      settledBy: card?.settledBy ?? null,
    };
  });
  const refused = lines.filter((l) => l.outcome === "CONFLICT" || l.outcome === "NOT_APPROVED").map((l) => l.orderId);
  return {
    settlementId: s.settlementId,
    network: s.network,
    networkPayoutId: s.networkPayoutId,
    status: s.status,
    match: s.match,
    amount: s.amount,
    eligibleAmount: s.eligibleAmount,
    withheld: s.withheld,
    fee: s.fee,
    tax: s.tax,
    matchedGross: s.matchedGross,
    unattributed: s.unattributed,
    orderCount: lines.filter((l) => l.outcome === "SETTLED" || l.outcome === "CANDIDATE").length,
    createdAt: s.createdAt,
    paidAt: s.paidAt,
    listed: s.orderIds !== null,
    windowFrom: s.windowFrom,
    orders,
    openCaseIds: openSettlementCaseIds(db, s.network, s.networkPayoutId, refused),
  };
}
