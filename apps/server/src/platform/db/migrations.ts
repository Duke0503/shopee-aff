/**
 * Forward-only migrations (AD-2). Files are `NNNN_name.sql`, the shape drizzle-kit
 * generates, applied in number order, each in its own transaction and recorded once in
 * `schema_migrations` with a checksum. There are no down migrations: a mistake is fixed
 * by a new migration, and a failed deploy restores the pre-migration backup (AD-26).
 *
 * A migration runs outside `tx` in a transaction of its own, with foreign keys off on
 * the connection, because a drizzle-kit table rebuild drops a referenced table and
 * `PRAGMA foreign_keys` is a no-op inside a transaction. `foreign_key_check` must come
 * back empty before the commit, so a rebuild can never leave a broken reference.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Clock } from "@cashback/core";

import type { Ledger } from "./ledger";

const MIGRATION_FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const DOWN_FILE = /(^|[._-])down([._-]|$)/i;
/** A statement that opens or ends a transaction; a trigger body's bare END is not one. */
const TRANSACTION_STATEMENT = /^(BEGIN(\s+(DEFERRED|IMMEDIATE|EXCLUSIVE))?(\s+TRANSACTION)?|COMMIT(\s+TRANSACTION)?|END\s+TRANSACTION|ROLLBACK(\s+TRANSACTION)?|SAVEPOINT\s.*|RELEASE\s.*)$/is;

export interface Migration {
  id: number;
  name: string;
  sql: string;
  checksum: string;
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

const checksumOf = (sql: string): string => createHash("sha256").update(sql).digest("hex");

function opensOwnTransaction(sql: string): boolean {
  return sql
    .replace(/--[^\n]*/g, "")
    .split(";")
    .some((statement) => TRANSACTION_STATEMENT.test(statement.trim()));
}

export function readMigrations(dir: string): Migration[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
  const migrations = files.map((file) => {
    if (DOWN_FILE.test(file.replace(/\.sql$/, ""))) throw new MigrationError(`down migrations are not supported: ${file}`);
    const match = MIGRATION_FILE.exec(file);
    if (!match) throw new MigrationError(`migration file must be named NNNN_name.sql: ${file}`);
    const sql = readFileSync(join(dir, file), "utf8").replace(/\r\n/g, "\n");
    if (opensOwnTransaction(sql)) throw new MigrationError(`a migration must not open or end its own transaction: ${file}`);
    return { id: Number(match[1]), name: file, sql, checksum: checksumOf(sql) };
  });
  const ids = migrations.map((m) => m.id);
  if (new Set(ids).size !== ids.length) throw new MigrationError("two migration files share a number");
  return migrations.sort((a, b) => a.id - b.id);
}

interface AppliedRow {
  id: number;
  checksum: string;
}

/** Runs one migration in its own transaction with foreign keys off, checked before commit. */
function applyOne(ledger: Ledger, m: Migration, appliedAt: string): void {
  const { sqlite } = ledger;
  sqlite.pragma("foreign_keys = OFF");
  try {
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      sqlite.exec(m.sql);
      const violations = sqlite.pragma("foreign_key_check") as unknown[];
      if (violations.length > 0) throw new MigrationError(`foreign key check failed after ${m.name}: ${violations.length} broken references`);
      sqlite.prepare("INSERT INTO schema_migrations (id, name, checksum, applied_at) VALUES (?, ?, ?, ?)").run(m.id, m.name, m.checksum, appliedAt);
      sqlite.exec("COMMIT");
    } catch (error) {
      if (sqlite.inTransaction) sqlite.exec("ROLLBACK");
      throw error;
    }
  } finally {
    sqlite.pragma("foreign_keys = ON");
  }
}

/** Applies the migrations not yet recorded and returns their file names. */
export function runMigrations(ledger: Ledger, migrations: readonly Migration[], clock: Clock): string[] {
  if (ledger.sqlite.inTransaction) throw new MigrationError("migrations run outside any transaction");
  ledger.sqlite.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)",
  );
  const applied = new Map(
    (ledger.sqlite.prepare("SELECT id, checksum FROM schema_migrations").all() as AppliedRow[]).map((r) => [r.id, r.checksum]),
  );
  const lastApplied = Math.max(0, ...applied.keys());
  const done: string[] = [];
  for (const m of migrations) {
    const checksum = applied.get(m.id);
    if (checksum !== undefined) {
      if (checksum !== m.checksum) throw new MigrationError(`migration changed after it was applied: ${m.name}`);
      continue;
    }
    if (m.id < lastApplied) throw new MigrationError(`migration is older than the last applied one: ${m.name}`);
    applyOne(ledger, m, clock.now());
    done.push(m.name);
  }
  return done;
}
