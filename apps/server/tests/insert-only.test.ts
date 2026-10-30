import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { INSERT_ONLY_TABLES, insertOnlyTriggersSql } from "../src/platform/db/insert-only";

function fixture(): Database.Database {
  const sqlite = new Database(":memory:");
  sqlite.exec("CREATE TABLE fixture_entries (id INTEGER PRIMARY KEY, amount INTEGER NOT NULL)");
  sqlite.exec(insertOnlyTriggersSql("fixture_entries"));
  sqlite.exec("INSERT INTO fixture_entries (id, amount) VALUES (1, -9263)");
  return sqlite;
}

describe("insert-only tables (Story 1.6 AC4, AD-17)", () => {
  it("AC4: the trigger rejects an UPDATE", () => {
    const sqlite = fixture();
    expect(() => sqlite.exec("UPDATE fixture_entries SET amount = 0 WHERE id = 1")).toThrow(/insert_only: fixture_entries/);
    expect(sqlite.prepare("SELECT amount FROM fixture_entries").get()).toEqual({ amount: -9263 });
  });

  it("AC4: the trigger rejects a DELETE", () => {
    const sqlite = fixture();
    expect(() => sqlite.exec("DELETE FROM fixture_entries")).toThrow(/insert_only: fixture_entries/);
    expect(sqlite.prepare("SELECT count(*) AS n FROM fixture_entries").get()).toEqual({ n: 1 });
  });

  it("still accepts inserts", () => {
    const sqlite = fixture();
    sqlite.exec("INSERT INTO fixture_entries (id, amount) VALUES (2, 9263)");
    expect(sqlite.prepare("SELECT sum(amount) AS open FROM fixture_entries").get()).toEqual({ open: 0 });
  });

  it("names the four tables of AD-17 and refuses an unsafe table name", () => {
    expect(INSERT_ONLY_TABLES).toEqual(["audit_entries", "order_status_history", "order_observations", "ledger_entries"]);
    expect(() => insertOnlyTriggersSql("x; DROP TABLE y")).toThrow(RangeError);
  });
});
