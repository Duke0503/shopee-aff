/**
 * The cutover's parity gate (AD-24, D44; Stories 8.7 and 8.8): the one verdict that lets the new
 * ledger go live. It is computed again from both databases, independent of the import's own
 * report: every row count the owner named (customers, aliases, orders, link requests, share codes,
 * payouts, campaign awards, clicks) must be equal, every customer's paid cashback, payout total
 * and paid bonus must match to the dong (paid-parity.ts), and the import report must say the
 * import finished with no row-by-row mismatch. Anything else is "fail" and the cutover aborts and
 * restarts the live system. The verdict holds counts, measures and customer ids only.
 */
import type BetterSqlite3 from "better-sqlite3";

import type { ImportReport } from "./import-report";
import { IMPORTED_PAID_TOTALS_SQL, LIVE_PAID_TOTALS_SQL, totals } from "./order-checks";
import { fullPaidParity } from "./paid-parity";

/** Each counted table: the live query and the new ledger's query, both `SELECT COUNT(*) AS n`. */
export const GATE_COUNTS = {
  customers: { live: "SELECT COUNT(*) AS n FROM customers", imported: "SELECT COUNT(*) AS n FROM customers" },
  aliases: { live: "SELECT COUNT(*) AS n FROM customer_aliases", imported: "SELECT COUNT(*) AS n FROM customer_aliases" },
  orders: { live: "SELECT COUNT(*) AS n FROM orders", imported: "SELECT COUNT(*) AS n FROM orders" },
  linkRequests: { live: "SELECT COUNT(*) AS n FROM link_requests", imported: "SELECT COUNT(*) AS n FROM link_requests" },
  shareCodes: { live: "SELECT COUNT(*) AS n FROM link_requests WHERE TRIM(COALESCE(share_code, '')) != ''", imported: "SELECT COUNT(*) AS n FROM share_codes" },
  payouts: { live: "SELECT COUNT(*) AS n FROM payment_transfers", imported: "SELECT COUNT(*) AS n FROM payouts" },
  campaignAwards: { live: "SELECT COUNT(*) AS n FROM campaign_awards", imported: "SELECT COUNT(*) AS n FROM campaign_awards" },
  clicks: { live: "SELECT COUNT(*) AS n FROM link_clicks", imported: "SELECT COUNT(*) AS n FROM link_clicks" },
} as const;

export type GateTable = keyof typeof GATE_COUNTS;

export interface GateCount {
  readonly live: number;
  readonly imported: number;
}

export interface GateVerdict {
  readonly result: "pass" | "fail";
  readonly counts: Record<GateTable, GateCount>;
  /** Customers compared to the dong, and the paid totals on each side. */
  readonly paid: { readonly customers: number; readonly liveTotal: number; readonly importedTotal: number; readonly mismatches: number; readonly mismatchedCustomers: readonly string[] };
  /** Why it failed, as codes (`count:<table>`, `paid_parity`, `import_not_ok`, `comparison:<table>`). */
  readonly problems: readonly string[];
}

const tableExists = (db: BetterSqlite3.Database, table: string): boolean => db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined;

function count(db: BetterSqlite3.Database, query: string): number {
  const table = /FROM (\w+)/.exec(query)?.[1] ?? "";
  if (!tableExists(db, table)) return 0;
  return (db.prepare(query).get() as { n: number }).n;
}

export function gateCounts(source: BetterSqlite3.Database, target: BetterSqlite3.Database): Record<GateTable, GateCount> {
  const entries = Object.entries(GATE_COUNTS).map(([table, q]) => [table, { live: count(source, q.live), imported: count(target, q.imported) }]);
  return Object.fromEntries(entries) as Record<GateTable, GateCount>;
}

/** One side's paid cashback over all customers but guests, from the per-customer totals parity compares. */
function paidTotal(perCustomer: ReadonlyMap<string, number>, houseIds: ReadonlySet<string>): number {
  let sum = 0;
  for (const [customerId, paid] of perCustomer) if (!houseIds.has(customerId)) sum += paid;
  return sum;
}

/** The verdict from its parts; pure, so every rule is tested without a database. */
export function gateVerdict(counts: Record<GateTable, GateCount>, paid: GateVerdict["paid"], report: Pick<ImportReport, "outcome" | "comparison"> | null): GateVerdict {
  const problems: string[] = [];
  if (report === null || !report.outcome.ok) problems.push("import_not_ok");
  for (const [table, c] of Object.entries(counts)) if (c.live !== c.imported) problems.push(`count:${table}`);
  if (paid.mismatches > 0 || paid.liveTotal !== paid.importedTotal) problems.push("paid_parity");
  for (const [table, c] of Object.entries(report?.comparison ?? {})) if (c.mismatches.length > 0) problems.push(`comparison:${table}`);
  return { result: problems.length === 0 ? "pass" : "fail", counts, paid, problems };
}

/** The gate over both databases and the import report written beside the new ledger. */
export function runGate(source: BetterSqlite3.Database, target: BetterSqlite3.Database, report: Pick<ImportReport, "outcome" | "comparison"> | null): GateVerdict {
  const houseIds = new Set((target.prepare("SELECT customer_id FROM customers WHERE role = 'HOUSE'").all() as { customer_id: string }[]).map((r) => r.customer_id));
  const parity = fullPaidParity(source, target, houseIds);
  const paid = {
    customers: parity.customers,
    liveTotal: paidTotal(totals(source, LIVE_PAID_TOTALS_SQL), houseIds),
    importedTotal: paidTotal(totals(target, IMPORTED_PAID_TOTALS_SQL), houseIds),
    mismatches: parity.mismatches.length,
    mismatchedCustomers: [...new Set(parity.mismatches.map((m) => m.customerId))],
  };
  return gateVerdict(gateCounts(source, target), paid, report);
}
