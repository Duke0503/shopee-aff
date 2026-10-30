import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixedClock } from "@cashback/core";
import { afterEach, describe, expect, it } from "vitest";

import { openLedger, type Ledger } from "../src/platform/db/ledger";
import { MigrationError, readMigrations, runMigrations } from "../src/platform/db/migrations";

const clock = fixedClock("2026-10-30T12:00:00.000Z");
const opened: Ledger[] = [];

function setup(files: Record<string, string>): { ledger: Ledger; dir: string } {
  const root = mkdtempSync(join(tmpdir(), "cashback-migrations-"));
  const dir = join(root, "migrations");
  writeFiles(dir, files);
  const ledger = openLedger(join(root, "data", "ledger.sqlite"));
  opened.push(ledger);
  return { ledger, dir };
}

function writeFiles(dir: string, files: Record<string, string>): void {
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), body, { flag: "w" });
  }
}

afterEach(() => {
  for (const ledger of opened.splice(0)) ledger.close();
});

const FILES = {
  "0002_add_title.sql": "ALTER TABLE things ADD COLUMN title TEXT;\n--> statement-breakpoint\nINSERT INTO things (id, title) VALUES (2, 'second');",
  "0010_index.sql": "CREATE INDEX things_title ON things (title);",
  "0001_things.sql": "CREATE TABLE things (id INTEGER PRIMARY KEY);\nINSERT INTO things (id) VALUES (1);",
};

describe("forward-only migrations (Story 1.6 AC5, AD-2)", () => {
  it("AC5: applies migrations in number order and records each with its time", () => {
    const { ledger, dir } = setup(FILES);
    expect(runMigrations(ledger, readMigrations(dir), clock)).toEqual(["0001_things.sql", "0002_add_title.sql", "0010_index.sql"]);
    expect(ledger.sqlite.prepare("SELECT id, title FROM things ORDER BY id").all()).toEqual([
      { id: 1, title: null },
      { id: 2, title: "second" },
    ]);
    expect(ledger.sqlite.prepare("SELECT id, applied_at FROM schema_migrations ORDER BY id").all()).toEqual([
      { id: 1, applied_at: "2026-10-30T12:00:00.000Z" },
      { id: 2, applied_at: "2026-10-30T12:00:00.000Z" },
      { id: 10, applied_at: "2026-10-30T12:00:00.000Z" },
    ]);
  });

  it("AC5: records each migration once; a second run applies nothing", () => {
    const { ledger, dir } = setup(FILES);
    runMigrations(ledger, readMigrations(dir), clock);
    expect(runMigrations(ledger, readMigrations(dir), clock)).toEqual([]);
    expect(ledger.sqlite.prepare("SELECT count(*) AS n FROM schema_migrations").get()).toEqual({ n: 3 });
  });

  it("AC5: does not support a down migration", () => {
    const { dir } = setup({ ...FILES, "0003_add_title.down.sql": "ALTER TABLE things DROP COLUMN title;" });
    expect(() => readMigrations(dir)).toThrow(/down migrations are not supported/);
  });

  it("refuses a migration that changed after it was applied", () => {
    const { ledger, dir } = setup(FILES);
    runMigrations(ledger, readMigrations(dir), clock);
    writeFiles(dir, { "0001_things.sql": "CREATE TABLE things (id INTEGER PRIMARY KEY, extra TEXT);" });
    expect(() => runMigrations(ledger, readMigrations(dir), clock)).toThrow(MigrationError);
  });

  it("refuses a new migration numbered below the last applied one", () => {
    const { ledger, dir } = setup(FILES);
    runMigrations(ledger, readMigrations(dir), clock);
    writeFiles(dir, { "0005_late.sql": "CREATE TABLE late (id INTEGER);" });
    expect(() => runMigrations(ledger, readMigrations(dir), clock)).toThrow(/older than the last applied/);
  });

  it("rolls back and does not record a migration that fails", () => {
    const { ledger, dir } = setup({ "0001_things.sql": FILES["0001_things.sql"], "0002_broken.sql": "INSERT INTO things (id) VALUES (3);\nINSERT INTO nowhere VALUES (1);" });
    expect(() => runMigrations(ledger, readMigrations(dir), clock)).toThrow(/no such table/);
    expect(ledger.sqlite.prepare("SELECT id FROM things").all()).toEqual([{ id: 1 }]);
    expect(ledger.sqlite.prepare("SELECT id FROM schema_migrations").all()).toEqual([{ id: 1 }]);
  });

  it("rejects a file that is not named NNNN_name.sql", () => {
    const { dir } = setup({ "add_things.sql": "SELECT 1;" });
    expect(() => readMigrations(dir)).toThrow(/NNNN_name\.sql/);
  });
});

const PARENTS = [
  "CREATE TABLE parents (id INTEGER PRIMARY KEY, name TEXT);",
  "CREATE TABLE children (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parents(id));",
  "INSERT INTO parents (id, name) VALUES (1, 'a'), (2, NULL);",
  "INSERT INTO children (id, parent_id) VALUES (10, 1), (20, 2);",
].join("\n");

/** The table rebuild drizzle-kit generates for a SQLite column change. */
const REBUILD = [
  "PRAGMA foreign_keys=OFF;--> statement-breakpoint",
  "CREATE TABLE `__new_parents` (`id` integer PRIMARY KEY, `name` text DEFAULT '' NOT NULL);--> statement-breakpoint",
  "INSERT INTO `__new_parents`(\"id\", \"name\") SELECT \"id\", coalesce(\"name\", '') FROM `parents`;--> statement-breakpoint",
  "DROP TABLE `parents`;--> statement-breakpoint",
  "ALTER TABLE `__new_parents` RENAME TO `parents`;--> statement-breakpoint",
  "PRAGMA foreign_keys=ON;",
].join("\n");

describe("migrations and foreign keys (review item 1)", () => {
  it("rebuilds a referenced table: child rows survive, the foreign key check passes, foreign keys end up on", () => {
    const { ledger, dir } = setup({ "0001_parents.sql": PARENTS, "0002_rebuild_parents.sql": REBUILD });
    expect(runMigrations(ledger, readMigrations(dir), clock)).toEqual(["0001_parents.sql", "0002_rebuild_parents.sql"]);
    expect(ledger.sqlite.prepare("SELECT id, parent_id FROM children ORDER BY id").all()).toEqual([
      { id: 10, parent_id: 1 },
      { id: 20, parent_id: 2 },
    ]);
    expect(ledger.sqlite.prepare("SELECT name FROM parents WHERE id = 2").get()).toEqual({ name: "" });
    expect(ledger.sqlite.pragma("foreign_key_check")).toEqual([]);
    expect(ledger.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("aborts a migration that leaves a broken reference, records nothing and turns foreign keys back on", () => {
    const { ledger, dir } = setup({ "0001_parents.sql": PARENTS, "0002_orphan.sql": "INSERT INTO children (id, parent_id) VALUES (30, 99);" });
    expect(() => runMigrations(ledger, readMigrations(dir), clock)).toThrow(/foreign key check failed/);
    expect(ledger.sqlite.prepare("SELECT count(*) AS n FROM children").get()).toEqual({ n: 2 });
    expect(ledger.sqlite.prepare("SELECT id FROM schema_migrations").all()).toEqual([{ id: 1 }]);
    expect(ledger.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("refuses a migration file that opens or ends its own transaction", () => {
    for (const body of ["BEGIN;\nCREATE TABLE a (id INTEGER);\nCOMMIT;", "CREATE TABLE a (id INTEGER);\nCOMMIT;", "BEGIN TRANSACTION;\nCREATE TABLE a (id INTEGER);", "ROLLBACK;"]) {
      const { dir } = setup({ "0001_own_tx.sql": body });
      expect(() => readMigrations(dir)).toThrow(/own transaction/);
    }
  });

  it("still accepts a trigger body with BEGIN ... END", () => {
    const { ledger, dir } = setup({
      "0001_trigger.sql": "CREATE TABLE t (id INTEGER);\nCREATE TRIGGER t_no_delete BEFORE DELETE ON t\nBEGIN\n  SELECT RAISE(ABORT, 'no');\nEND;",
    });
    expect(runMigrations(ledger, readMigrations(dir), clock)).toEqual(["0001_trigger.sql"]);
  });
});

describe("migration checksums (review item 3)", () => {
  it("hashes the CRLF and LF versions of a file the same", () => {
    const lf = "CREATE TABLE things (id INTEGER PRIMARY KEY);\nINSERT INTO things (id) VALUES (1);\n";
    const a = setup({ "0001_things.sql": lf });
    const b = setup({ "0001_things.sql": lf.replaceAll("\n", "\r\n") });
    expect(readMigrations(b.dir)[0]?.checksum).toBe(readMigrations(a.dir)[0]?.checksum);
  });
});
