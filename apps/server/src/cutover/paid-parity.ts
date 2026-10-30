/**
 * Paid parity over every measure (D44, AD-24, Story 2.4): for each customer the new ledger must
 * hold, to the dong, the same paid cashback (order-checks.ts), the same total of payouts and the
 * same paid campaign bonuses as the live copy; "pass" only when every customer matches on all
 * three. Each "live" figure is one named SQL below, with a merged customer's alias read as the
 * survivor the import also resolves it to. Both sides are SQL SUM()s over stored integer columns
 * (AD-5); the difference reported is imported minus live, null when a live sum is not whole dong.
 * Guests (HOUSE) are never paid (D5) and left out.
 */
import { differenceDong } from "@cashback/money";
import type BetterSqlite3 from "better-sqlite3";

import type { FullPaidParity, ParityMeasure } from "./import-report";
import { IMPORTED_PAID_TOTALS_SQL, LIVE_PAID_TOTALS_SQL, totals } from "./order-checks";

const LIVE_OWNER = (table: string) => `
  FROM ${table} t
  LEFT JOIN customers c ON c.customer_id = t.customer_id
  LEFT JOIN customer_aliases a ON c.customer_id IS NULL AND a.alias = t.customer_id`;

/** Live payout total per customer: every recorded transfer (dashboard.py:2960 sums the same). */
export const LIVE_PAYOUT_TOTALS_SQL = `
SELECT COALESCE(c.customer_id, a.customer_id, t.customer_id) AS customer_id, COALESCE(SUM(t.amount), 0) AS paid
${LIVE_OWNER("payment_transfers")}
 GROUP BY 1`;

/** Live paid bonus per customer: awards in state `paid` (campaigns.py:23-26). */
export const LIVE_PAID_BONUS_SQL = `
SELECT COALESCE(c.customer_id, a.customer_id, t.customer_id) AS customer_id, COALESCE(SUM(t.amount), 0) AS paid
${LIVE_OWNER("campaign_awards")}
 WHERE t.status = 'paid'
 GROUP BY 1`;

export const IMPORTED_PAYOUT_TOTALS_SQL = `
SELECT customer_id, COALESCE(SUM(transfer_amount), 0) AS paid
  FROM payouts
 WHERE status = 'RECORDED'
 GROUP BY customer_id`;

export const IMPORTED_PAID_BONUS_SQL = `
SELECT customer_id, COALESCE(SUM(amount), 0) AS paid
  FROM campaign_awards
 WHERE status = 'PAID'
 GROUP BY customer_id`;

const MEASURES: readonly { measure: ParityMeasure; live: string; imported: string }[] = [
  { measure: "paid_cashback", live: LIVE_PAID_TOTALS_SQL, imported: IMPORTED_PAID_TOTALS_SQL },
  { measure: "payout_total", live: LIVE_PAYOUT_TOTALS_SQL, imported: IMPORTED_PAYOUT_TOTALS_SQL },
  { measure: "paid_bonus", live: LIVE_PAID_BONUS_SQL, imported: IMPORTED_PAID_BONUS_SQL },
];

export function fullPaidParity(source: BetterSqlite3.Database, target: BetterSqlite3.Database, houseIds: ReadonlySet<string>): FullPaidParity {
  const sides = MEASURES.map((m) => ({ measure: m.measure, live: totals(source, m.live), imported: totals(target, m.imported) }));
  const customers = [...new Set(sides.flatMap((s) => [...s.live.keys(), ...s.imported.keys()]))].filter((id) => !houseIds.has(id)).sort();
  const mismatches: FullPaidParity["mismatches"] = [];
  for (const customerId of customers) {
    for (const side of sides) {
      const live = side.live.get(customerId) ?? 0;
      const imported = side.imported.get(customerId) ?? 0;
      if (live === imported) continue;
      const difference = Number.isSafeInteger(live) && Number.isSafeInteger(imported) ? differenceDong(imported, live) : null;
      mismatches.push({ customerId, measure: side.measure, live, imported, difference });
    }
  }
  return { result: mismatches.length === 0 ? "pass" : "fail", customers: customers.length, mismatches };
}
