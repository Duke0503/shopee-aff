/**
 * The order checks of the import report. Paid parity (D44, AD-24): every customer's paid total
 * in the new ledger equals the live one to the dong, "pass" only when all match. Both sides use
 * one definition of paid (D4, never pay twice): a live order is paid when its `paid_at` is set or
 * its status is `paid`, and exactly those orders are imported PAID. "Live paid" is the one named
 * SQL below, with a merged customer's alias read as the survivor the import also resolves it to.
 * A live order with only one of the two marks is a paid status conflict: it counts as paid on
 * both sides, so it does not fail parity by itself, and is listed for the owner to sign off.
 * Both sides are SQL SUM()s over stored integer columns (AD-5); nothing is added up in code.
 * Guests (HOUSE) are left out: they are never paid (D5). The cashback check lists every stored
 * cashback the FR-13 split would compute differently; the stored amount is the one kept (D34).
 */
import { splitCommission } from "@cashback/money";
import type BetterSqlite3 from "better-sqlite3";

import type { ImportedOrder } from "../modules/orders/index";
import type { OrdersSection, PaidParity, PaidStatusConflict } from "./import-report";

/** A live paid time is set when it holds any text, readable or not. */
const LIVE_PAID_AT_SET = "(o.paid_at IS NOT NULL AND o.paid_at != '')";
const LIVE_PAID = `(o.status = 'paid' OR ${LIVE_PAID_AT_SET})`;

/** Live paid cashback per customer: every paid order (D4), the owner read through customer_aliases. */
export const LIVE_PAID_TOTALS_SQL = `
SELECT COALESCE(c.customer_id, a.customer_id, o.customer_id) AS customer_id,
       COALESCE(SUM(COALESCE(o.cashback_amount, 0)), 0) AS paid
  FROM orders o
  LEFT JOIN customers c ON c.customer_id = o.customer_id
  LEFT JOIN customer_aliases a ON c.customer_id IS NULL AND a.alias = o.customer_id
 WHERE ${LIVE_PAID}
 GROUP BY 1`;

export const LIVE_PAID_STATUS_CONFLICTS_SQL = `
SELECT o.order_id, o.status, ${LIVE_PAID_AT_SET} AS paid_at_set
  FROM orders o
 WHERE (o.status = 'paid') != ${LIVE_PAID_AT_SET}
 ORDER BY o.order_id`;

export const IMPORTED_PAID_TOTALS_SQL = `
SELECT customer_id, COALESCE(SUM(COALESCE(cashback, 0)), 0) AS paid
  FROM orders
 WHERE status = 'PAID' AND customer_id IS NOT NULL
 GROUP BY customer_id`;

type Totals = Map<string, number>;

export const totals = (db: BetterSqlite3.Database, query: string): Totals =>
  new Map((db.prepare(query).all() as { customer_id: string | null; paid: number }[]).map((r) => [r.customer_id ?? "", r.paid]));

export function paidParity(source: BetterSqlite3.Database, target: BetterSqlite3.Database, houseIds: ReadonlySet<string>): PaidParity {
  const live = totals(source, LIVE_PAID_TOTALS_SQL);
  const imported = totals(target, IMPORTED_PAID_TOTALS_SQL);
  const customers = [...new Set([...live.keys(), ...imported.keys()])].filter((id) => !houseIds.has(id)).sort();
  const mismatches = customers
    .map((customerId) => ({ customerId, live: live.get(customerId) ?? 0, imported: imported.get(customerId) ?? 0 }))
    .filter((row) => row.live !== row.imported);
  return { result: mismatches.length === 0 ? "pass" : "fail", customers: customers.length, mismatches };
}

export function paidStatusConflicts(source: BetterSqlite3.Database): PaidStatusConflict[] {
  const rows = source.prepare(LIVE_PAID_STATUS_CONFLICTS_SQL).all() as { order_id: string; status: string; paid_at_set: number }[];
  return rows.map((r) => ({ orderId: r.order_id, kind: r.paid_at_set === 1 ? "paid_at_without_paid_status" : "paid_status_without_paid_at", liveStatus: r.status }));
}

/** Stored cashback the FR-13 split would compute differently, with the live 10% withholding (D34). */
export function cashbackDifferences(orders: readonly ImportedOrder[], houseIds: ReadonlySet<string>): OrdersSection["cashbackDifferences"] {
  const out: OrdersSection["cashbackDifferences"] = [];
  for (const o of orders) {
    if (o.network === null || o.approvedCommission === null || o.cashback === null) continue;
    if (o.customerId !== null && houseIds.has(o.customerId)) continue;
    if (!["APPROVED", "PAID", "REVERSED"].includes(o.status)) continue;
    const newSplit = splitCommission({ approvedCommission: o.approvedCommission, network: o.network, withheld: true }).cashback;
    if (newSplit !== o.cashback) out.push({ orderId: o.orderId, stored: o.cashback, newSplit });
  }
  return out.sort((a, b) => (a.orderId < b.orderId ? -1 : 1));
}

export function countBy<T>(rows: readonly T[], key: (row: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))) out[key(row)] = (out[key(row)] ?? 0) + 1;
  return out;
}
