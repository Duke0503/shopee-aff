/**
 * The row-by-row comparison of identity in the report (Story 2.2 AC1): every live customer id
 * with its code and Zalo id, and every alias with its customer, read back from the new ledger.
 * Live values are compared in their normalised form (codes trimmed and upper case, Zalo ids
 * trimmed, blanks as null), the form the import writes and records in `report.normalised`.
 */
import type BetterSqlite3 from "better-sqlite3";

import { skippedKeys, type ReportNote, type TableComparison } from "./import-report";

type Row = Record<string, string | number | null>;

export function compareRows(sourceRows: Row[], targetRows: Row[], key: string, fields: readonly string[], skipped: ReadonlySet<string>): TableComparison {
  const target = new Map(targetRows.map((row) => [String(row[key] ?? ""), row]));
  const mismatches: TableComparison["mismatches"] = [];
  for (const row of sourceRows) {
    const id = String(row[key] ?? "");
    if (skipped.has(id)) continue;
    const imported = target.get(id);
    if (!imported) {
      mismatches.push({ key: id, field: key });
      continue;
    }
    for (const field of fields) {
      const want = row[field] === "" ? null : (row[field] ?? null);
      if (want !== (imported[field] ?? null)) mismatches.push({ key: id, field });
    }
  }
  return { source: sourceRows.length, imported: targetRows.length, mismatches };
}

export function compareIdentity(source: BetterSqlite3.Database, target: BetterSqlite3.Database, notes: readonly ReportNote[]): Record<string, TableComparison> {
  const skippedAliases = skippedKeys(notes, "customer_aliases");
  const all = (db: BetterSqlite3.Database, query: string) => db.prepare(query).all() as Row[];
  return {
    customers: compareRows(
      all(source, "SELECT customer_id, NULLIF(UPPER(TRIM(customer_code)), '') AS customer_code, NULLIF(TRIM(zalo_user_id), '') AS zalo_user_id FROM customers ORDER BY customer_id"),
      all(target, "SELECT customer_id, customer_code, zalo_user_id FROM customers ORDER BY customer_id"),
      "customer_id",
      ["customer_code", "zalo_user_id"],
      new Set(),
    ),
    customer_aliases: compareRows(
      all(source, "SELECT alias, customer_id FROM customer_aliases ORDER BY alias"),
      all(target, "SELECT alias, customer_id FROM customer_aliases ORDER BY alias"),
      "alias",
      ["customer_id"],
      skippedAliases,
    ),
  };
}
