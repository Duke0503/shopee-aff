/**
 * The cutover import of orders (AD-24, AD-8, Story 2.3): writes each live order exactly as
 * given, with its stored amounts, status and paid time, into empty tables, inside the caller's
 * `tx`. Nothing is recomputed (D34): the cashback stored live is the cashback kept, except a
 * guest order's, which is 0 (D5) and decided by the caller. Each order gets exactly one item
 * carrying its own amounts and one history row by the actor `cutover`; reconciliation stores
 * the real items later without touching the stored amounts. Rows are written in key order so
 * two imports of one source give identical ledgers. The import writes one audit entry with its
 * counts in the same transaction (AD-17).
 */
import { vnDateOf, type Instant, type OrderStatus } from "@cashback/core";

import { assertTablesEmpty, sortByKey } from "../../platform/db/bulk-import";
import type { LedgerDb } from "../../platform/db/ledger";
import type { CommandAudit } from "../../platform/ports/audit.port";
import { orderItems, orders, orderStatusHistory, settlementPeriods, type OrderNetwork } from "./schema";

export const CUTOVER_ACTOR = "cutover";

export interface ImportedOrder {
  orderId: string;
  network: OrderNetwork | null;
  platform: string;
  customerId: string | null;
  requestId: string | null;
  status: OrderStatus;
  orderValue: number | null;
  estimatedCommission: number | null;
  approvedCommission: number | null;
  cashback: number | null;
  rejectionReason: string | null;
  recordedAt: Instant | null;
  recordedAtApproximate: boolean;
  approvedAt: Instant | null;
  paidAt: Instant | null;
  networkBatchId: string | null;
  settledAt: Instant | null;
  updatedAt: Instant | null;
}

export interface OrdersImport {
  orders: readonly ImportedOrder[];
  /** The import's own time, written on each history row. */
  importedAt: Instant;
}

export interface OrdersImportResult {
  orders: number;
  items: number;
  history: number;
  settlementPeriods: number;
}

export class OrdersImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrdersImportError";
  }
}

const ORDER_TABLES = ["orders", "order_items", "order_status_history", "order_observations", "settlement_periods"];
const APPROVED_ONCE: readonly OrderStatus[] = ["APPROVED", "PAID", "REVERSED"];

function refuseUnlessEmpty(db: LedgerDb): void {
  assertTablesEmpty(db, ORDER_TABLES, (table, n) => new OrdersImportError(`orders import needs empty tables; ${table} has ${n} rows`));
}

/** One withheld period per (network, Vietnam month of approval): the live split always withheld 10%. */
function periodsOf(rows: readonly ImportedOrder[]): { network: OrderNetwork; periodMonth: string }[] {
  const keys = new Set<string>();
  for (const o of rows) {
    if (o.network !== null && o.approvedAt !== null && APPROVED_ONCE.includes(o.status)) keys.add(`${o.network}|${vnDateOf(o.approvedAt).slice(0, 7)}`);
  }
  return [...keys].sort().map((k) => {
    const [network, periodMonth] = k.split("|") as [OrderNetwork, string];
    return { network, periodMonth };
  });
}

/** Imports orders into empty tables; call inside `tx`. */
export function importOrders(db: LedgerDb, data: OrdersImport, by: CommandAudit): OrdersImportResult {
  refuseUnlessEmpty(db);
  const sorted = sortByKey(data.orders, (o) => o.orderId);
  for (const o of sorted) {
    db.insert(orders)
      .values({ ...o, lastSeenInReportAt: null, origin: "CUTOVER" })
      .run();
    db.insert(orderItems)
      .values({
        orderId: o.orderId,
        lineNo: 1,
        price: o.orderValue,
        estimatedCommission: o.estimatedCommission,
        approvedCommission: o.approvedCommission,
        networkStatus: null,
        origin: "CUTOVER",
      })
      .run();
    db.insert(orderStatusHistory)
      .values({ orderId: o.orderId, fromStatus: null, toStatus: o.status, actor: CUTOVER_ACTOR, reason: "imported from the live ledger", changedAt: data.importedAt })
      .run();
  }
  const periods = periodsOf(sorted);
  for (const p of periods) db.insert(settlementPeriods).values({ ...p, withheld: true, origin: "CUTOVER" }).run();
  const result = { orders: sorted.length, items: sorted.length, history: sorted.length, settlementPeriods: periods.length };
  by.audit.record({ actor: by.actor, event: "orders.orders.imported", entityId: by.actor.id, payload: result });
  return result;
}
