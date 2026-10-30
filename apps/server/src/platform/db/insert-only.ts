/**
 * Insert-only tables (AD-17, code.md §5). History and money entries are never
 * rewritten: code issues no UPDATE or DELETE on them, and these triggers reject one
 * that slips through. A migration that creates such a table adds the triggers with it.
 */

export const INSERT_ONLY_TABLES = ["audit_entries", "order_status_history", "order_observations", "ledger_entries"] as const;

const TABLE_NAME = /^[a-z][a-z0-9_]*$/;

/** The SQL that makes `table` insert-only, for a migration to run. */
export function insertOnlyTriggersSql(table: string): string {
  if (!TABLE_NAME.test(table)) throw new RangeError(`not a table name: ${table}`);
  return [
    `CREATE TRIGGER IF NOT EXISTS ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, 'insert_only: ${table}'); END;`,
    `CREATE TRIGGER IF NOT EXISTS ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, 'insert_only: ${table}'); END;`,
  ].join("\n");
}
