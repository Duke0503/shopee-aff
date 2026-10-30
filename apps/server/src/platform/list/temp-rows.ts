/**
 * Rows a list builds in memory and then lists through `defineList()` (AD-12, AD-6): a balance is
 * not a stored column, so the Payouts and Customers lists compute each row's figures once and copy
 * them into a temporary table of the request's own connection, where search, sort, the page, the
 * count, the facets and the summary all come from one WHERE. The table lives in SQLite's
 * per-connection temp database, never the ledger file: filling it takes no ledger write lock, so
 * a list never holds the one writer (AD-2). The rows go in inside one savepoint and are deleted
 * before the answer returns; all of it runs synchronously on the one connection, so no ledger
 * write can land between the reads.
 */
import { sql } from "drizzle-orm";

import type { LedgerDb } from "../db/ledger";

export interface TempTable {
  /** The table name inside the temp schema; trusted spec text. */
  readonly name: string;
  /** The column list of CREATE TEMP TABLE, in the order `values` gives them. */
  readonly columns: string;
}

const NAME = /^[a-z_][a-z0-9_]*$/;

/** Fills `temp.<name>` with `values` of each row, runs `fn`, and empties the table again. */
export function withTempRows<R, T>(
  db: LedgerDb,
  table: TempTable,
  rows: readonly R[],
  values: (row: R) => readonly unknown[],
  fn: () => T,
): T {
  if (!NAME.test(table.name)) throw new Error(`temp table name is not plain: ${table.name}`);
  const name = sql.raw(`temp.${table.name}`);
  const savepoint = sql.raw(`${table.name}_fill`);
  db.run(sql.raw(`CREATE TEMP TABLE IF NOT EXISTS ${table.name} (${table.columns})`));
  db.run(sql`SAVEPOINT ${savepoint}`);
  try {
    db.run(sql`DELETE FROM ${name}`);
    for (const row of rows) {
      db.run(
        sql`INSERT INTO ${name} VALUES (${sql.join(
          values(row).map((v) => sql`${v}`),
          sql`, `,
        )})`,
      );
    }
    db.run(sql`RELEASE ${savepoint}`);
  } catch (error) {
    db.run(sql`ROLLBACK TO ${savepoint}`);
    db.run(sql`RELEASE ${savepoint}`);
    throw error;
  }
  try {
    return fn();
  } finally {
    db.run(sql`DELETE FROM ${name}`);
  }
}
