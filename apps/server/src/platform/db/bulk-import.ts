/**
 * Helpers for the one-shot imports into a fresh ledger (AD-24): each module's import refuses
 * tables that already hold rows, so an import never merges into data, and writes its rows in key
 * order, so two imports of one source give identical ledgers.
 */
import { sql } from "drizzle-orm";

import type { LedgerDb } from "./ledger";

const TABLE_NAME = /^[a-z][a-z0-9_]*$/;

/** Throws `fail(table, rows)` for the first table that is not empty. */
export function assertTablesEmpty(db: LedgerDb, tables: readonly string[], fail: (table: string, rows: number) => Error): void {
  for (const table of tables) {
    if (!TABLE_NAME.test(table)) throw new RangeError(`not a table name: ${table}`);
    const row = db.get<{ n: number }>(sql.raw(`SELECT count(*) AS n FROM ${table}`));
    if (row.n > 0) throw fail(table, row.n);
  }
}

/** A copy of `rows` sorted by a text key, by code unit, the same on every machine. */
export function sortByKey<T>(rows: readonly T[], key: (row: T) => string): T[] {
  return [...rows].sort((a, b) => {
    const [x, y] = [key(a), key(b)];
    return x < y ? -1 : x > y ? 1 : 0;
  });
}
