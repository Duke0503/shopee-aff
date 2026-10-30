import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

export interface OpenDatabaseOptions {
  path: string;
  readonly?: boolean;
}

/**
 * Open the shared SQLite file with the settings agreed in ADR-18:
 * WAL mode, foreign keys on, and a SHORT busy_timeout — better-sqlite3 waits
 * by blocking the whole Node process, so a long wait would freeze every job
 * including the browser bridge. A short wait plus one retry keeps it
 * responsive.
 */
export function openDatabase({ path, readonly = false }: OpenDatabaseOptions): Db {
  const sqlite = new Database(path, { readonly });
  if (!readonly) {
    sqlite.pragma("journal_mode = WAL");
  }
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  return drizzle(sqlite, { schema });
}

/**
 * Run a write transaction with BEGIN IMMEDIATE (ADR-18). In WAL mode a
 * transaction that starts as a read and later writes fails at once with
 * "database is busy"; taking the write lock up front makes the wait/retry
 * above actually work.
 */
export function withImmediateTransaction<T>(db: Db, fn: (tx: Db) => T): T {
  return db.transaction((tx) => fn(tx as unknown as Db), { behavior: "immediate" });
}
