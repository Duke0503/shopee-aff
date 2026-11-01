/**
 * The ledger database (AD-2, D33): one SQLite file, opened for writing only by the
 * server. WAL lets readers run beside the one writer; a short busy timeout keeps a
 * waiting write from blocking the event loop (and the bridge long-poll) for long.
 * Every write goes through `tx`.
 *
 * Each connection gets the deterministic SQL function `shopee_product_key(text)` (packages/core
 * `shopeeProductKeyOf`), so a migration can backfill product keys with the very rule new link
 * requests use (migration 0023, Story 5.2).
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { shopeeProductKeyOf } from "@cashback/core";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import { runTransaction } from "./transaction";

export const BUSY_TIMEOUT_MS = 1000;
export const LEDGER_FILE = "ledger.sqlite";

export type LedgerDb = BetterSQLite3Database;

export interface Ledger {
  readonly sqlite: Database.Database;
  readonly db: LedgerDb;
  /** Runs `fn` in one `BEGIN IMMEDIATE` transaction; `fn` must be synchronous. */
  tx<T>(fn: (db: LedgerDb) => T): T;
  close(): void;
}

export function openLedger(path: string): Ledger {
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path, { timeout: BUSY_TIMEOUT_MS });
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  sqlite.function("shopee_product_key", { deterministic: true }, (text: unknown) => shopeeProductKeyOf(typeof text === "string" ? text : null));
  const db = drizzle({ client: sqlite });
  return {
    sqlite,
    db,
    tx: (fn) => runTransaction(sqlite, (client) => drizzle({ client }), fn),
    close: () => sqlite.close(),
  };
}
