/**
 * The ledger side of the shadow run (D44, AD-24, Story 2.9): the live copy is opened read-only
 * with the cutover import's refusals, read with the import's own readers, and imported into an
 * in-memory ledger that is thrown away, so the shadow run judges exactly what the cutover would
 * import and writes no file but its report. Paid parity is the import's (paid-parity.ts).
 *
 * "Live payable" and "live waiting" are the named SQL below, the live system's own definitions:
 * payable is `payouts.collect` exactly (approved, `paid_at` NULL, an existing customer, not the
 * house account) plus the confirmed bonus riding on those orders (`campaigns.bonus_owed`); the
 * approved unpaid orders it cannot list are read separately as orphans; waiting is every awaiting,
 * unpaid order's estimated commission, valued by the caller with the FR-13 split. An alias is
 * read as its survivor, as the import resolves it. The bank fingerprint key is random per run:
 * fingerprints never leave the in-memory ledger.
 */
import { randomBytes } from "node:crypto";
import type { Clock } from "@cashback/core";
import { sumDong } from "@cashback/money";
import type BetterSqlite3 from "better-sqlite3";

import { openLedger } from "../platform/db/ledger";
import { MIGRATIONS_DIR, readMigrations, runMigrations } from "../platform/db/migrations";
import { emptyReport, type FullPaidParity, type ImportReport } from "./import-report";
import { readLive, writeLive, type LiveData } from "./import-steps";
import { openLiveCopy } from "./live-source";
import { assertEveryTimeColumnHasRule } from "./live-time";
import { IMPORTED_PAID_TOTALS_SQL, LIVE_PAID_TOTALS_SQL, totals } from "./order-checks";
import { fullPaidParity } from "./paid-parity";

const OWNER = `COALESCE(c.customer_id, a.customer_id, o.customer_id)`;
const OWNER_JOIN = `
  LEFT JOIN customers c ON c.customer_id = o.customer_id
  LEFT JOIN customer_aliases a ON c.customer_id IS NULL AND a.alias = o.customer_id
  LEFT JOIN customers s ON s.customer_id = ${OWNER}`;
const NOT_HOUSE = `COALESCE(s.role, 'user') != 'house'`;

const CONFIRMED_BONUS = `(SELECT COALESCE(SUM(w.amount), 0) FROM campaign_awards w WHERE w.order_id = o.order_id AND w.status = 'confirmed')`;

/**
 * Live payable per customer, exactly as payouts.py collect() lists it: approved orders with
 * `paid_at` NULL, INNER JOIN customers (an order of an id that is no customer is never listed),
 * the house account left out, plus campaigns.py bonus_owed() over those orders.
 */
export const LIVE_PAYABLE_SQL = `
SELECT o.customer_id AS customer_id,
       COALESCE(SUM(COALESCE(o.cashback_amount, 0)), 0) AS cashback,
       COALESCE(SUM(${CONFIRMED_BONUS}), 0) AS bonus
  FROM orders o JOIN customers c ON c.customer_id = o.customer_id
 WHERE o.status = 'approved' AND o.paid_at IS NULL
   AND COALESCE(c.role, 'user') != 'house'
 GROUP BY o.customer_id`;

/** The approved unpaid orders collect() cannot list: their customer id is no customer (a merged alias or a gone id). */
export const LIVE_ORPHAN_OWED_SQL = `
SELECT o.order_id, o.customer_id, o.cashback_amount, ${CONFIRMED_BONUS} AS bonus
  FROM orders o LEFT JOIN customers c ON c.customer_id = o.customer_id
 WHERE o.status = 'approved' AND o.paid_at IS NULL AND c.customer_id IS NULL
 ORDER BY o.order_id`;

export interface LiveOrphanOwed {
  order_id: string;
  customer_id: string | null;
  cashback_amount: unknown;
  bonus: number;
}

/** Live waiting orders: awaiting approval and not paid (payouts.py balance_for). */
export const LIVE_WAITING_ORDERS_SQL = `
SELECT ${OWNER} AS customer_id, o.order_id, o.platform, o.estimated_commission
  FROM orders o${OWNER_JOIN}
 WHERE o.status = 'awaiting_approval' AND (o.paid_at IS NULL OR o.paid_at = '') AND ${NOT_HOUSE}
 ORDER BY o.order_id`;

export interface LiveWaitingOrder {
  customer_id: string | null;
  order_id: string;
  platform: string;
  estimated_commission: unknown;
}

export interface ShadowLedger {
  live: LiveData;
  /** The notes the import's readers wrote; the shadow report counts them. */
  importReport: ImportReport;
  paidParity: FullPaidParity;
  livePayable: Map<string, number | null>;
  liveOrphanOwed: LiveOrphanOwed[];
  liveWaiting: LiveWaitingOrder[];
  livePaid: Map<string, number>;
  importedPaid: Map<string, number>;
}

export interface ShadowLedgerOptions {
  sourcePath: string;
  liveLedgerPath: string | null;
  clock: Clock;
  migrationsDir?: string;
}

/** Cashback plus bonus per customer through the money package; a live sum that is not whole dong is listed as null. */
function livePayable(source: BetterSqlite3.Database): Map<string, number | null> {
  const rows = source.prepare(LIVE_PAYABLE_SQL).all() as { customer_id: string | null; cashback: number; bonus: number }[];
  return new Map(rows.map((r) => [r.customer_id ?? "", Number.isSafeInteger(r.cashback) && Number.isSafeInteger(r.bonus) ? sumDong([r.cashback, r.bonus], "live payable") : null]));
}

function importInMemory(source: BetterSqlite3.Database, options: ShadowLedgerOptions): ShadowLedger {
  const importReport = emptyReport();
  const live = readLive(source, importReport);
  const ledger = openLedger(":memory:");
  try {
    runMigrations(ledger, readMigrations(options.migrationsDir ?? MIGRATIONS_DIR), options.clock);
    writeLive(ledger, live, randomBytes(32).toString("hex"), options.clock);
    return {
      live,
      importReport,
      paidParity: fullPaidParity(source, ledger.sqlite, live.context.houseIds),
      livePayable: livePayable(source),
      liveOrphanOwed: source.prepare(LIVE_ORPHAN_OWED_SQL).all() as LiveOrphanOwed[],
      liveWaiting: source.prepare(LIVE_WAITING_ORDERS_SQL).all() as LiveWaitingOrder[],
      livePaid: totals(source, LIVE_PAID_TOTALS_SQL),
      importedPaid: totals(ledger.sqlite, IMPORTED_PAID_TOTALS_SQL),
    };
  } finally {
    ledger.close();
  }
}

/** Reads the live copy read-only and imports it in memory; nothing is written anywhere. */
export function readShadowLedger(options: ShadowLedgerOptions): ShadowLedger {
  const source = openLiveCopy(options.sourcePath, { liveLedgerPath: options.liveLedgerPath });
  try {
    assertEveryTimeColumnHasRule(source);
    return importInMemory(source, options);
  } finally {
    source.close();
  }
}
