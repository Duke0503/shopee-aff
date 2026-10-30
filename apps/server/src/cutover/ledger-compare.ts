/**
 * The row-by-row comparison of orders and links in the report (Stories 2.3, 2.5): every live
 * order id with its owner and stored amounts, every link request with its owner and link, and
 * every share code with its request, read back from the new ledger. The live side is written in
 * the form the import keeps: a guest order's cashback is 0 (D5), with the guest decided by the
 * import's own rule (the mapped role HOUSE, the owner read through aliases), and a blank link is
 * none. Rows the report already names (COMPARISON_SKIPS) are not compared again.
 */
import type BetterSqlite3 from "better-sqlite3";

import { ownerOf, type CutoverContext } from "./cutover-context";
import { compareRows } from "./identity-compare";
import { skippedKeys, type ReportNote, type TableComparison } from "./import-report";

type Row = Record<string, string | number | null>;

const all = (db: BetterSqlite3.Database, query: string) => db.prepare(query).all() as Row[];

const AMOUNTS = ["order_value", "estimated_commission", "approved_commission"] as const;

function liveOrders(source: BetterSqlite3.Database, context: CutoverContext): Row[] {
  return all(source, `SELECT order_id, customer_id, ${AMOUNTS.join(", ")}, cashback_amount AS cashback FROM orders ORDER BY order_id`).map((row) => {
    const id = row["customer_id"];
    const owner = ownerOf(context, typeof id === "string" ? id : null);
    return owner !== null && context.houseIds.has(owner.customerId) ? { ...row, cashback: 0 } : row;
  });
}

export function compareOrdersAndLinks(source: BetterSqlite3.Database, target: BetterSqlite3.Database, notes: readonly ReportNote[], context: CutoverContext): Record<string, TableComparison> {
  return {
    orders: compareRows(
      liveOrders(source, context),
      all(target, `SELECT order_id, customer_id, ${AMOUNTS.join(", ")}, cashback FROM orders ORDER BY order_id`),
      "order_id",
      ["customer_id", ...AMOUNTS, "cashback"],
      skippedKeys(notes, "orders"),
    ),
    link_requests: compareRows(
      all(source, "SELECT request_id, customer_id, CASE WHEN TRIM(COALESCE(affiliate_url, '')) = '' THEN NULL ELSE affiliate_url END AS affiliate_url FROM link_requests ORDER BY request_id"),
      all(target, "SELECT request_id, customer_id, affiliate_url FROM link_requests ORDER BY request_id"),
      "request_id",
      ["customer_id", "affiliate_url"],
      skippedKeys(notes, "link_requests"),
    ),
    share_codes: compareRows(
      all(source, "SELECT request_id, share_code AS code FROM link_requests WHERE share_code IS NOT NULL AND share_code != '' ORDER BY request_id"),
      all(target, "SELECT request_id, code FROM share_codes ORDER BY request_id"),
      "request_id",
      ["code"],
      skippedKeys(notes, "share_codes"),
    ),
  };
}
