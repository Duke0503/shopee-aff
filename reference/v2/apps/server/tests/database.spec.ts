import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { openDatabase } from "../src/shared/database/connection";
import { customers } from "../src/shared/database/schema";

const dbPath = fileURLToPath(new URL("../.data/cashback.readonly.db", import.meta.url));
const hasCopy = existsSync(dbPath);

function tableNames(): string[] {
  const raw = new Database(dbPath, { readonly: true });
  const rows = raw
    .prepare("select name from sqlite_master where type = 'table'")
    .all() as { name: string }[];
  raw.close();
  return rows.map((row) => row.name);
}

describe.skipIf(!hasCopy)("drizzle mirrors the live SQLite schema (read-only)", () => {
  it("sees every table from the database copy", () => {
    expect(tableNames().length).toBeGreaterThanOrEqual(20);
  });

  it("runs a SELECT against every table through drizzle", () => {
    const db = openDatabase({ path: dbPath, readonly: true });
    for (const name of tableNames()) {
      expect(() => db.all(sql`select 1 from ${sql.identifier(name)} limit 1`)).not.toThrow();
    }
  });

  it("reads a known table through a typed query", () => {
    const db = openDatabase({ path: dbPath, readonly: true });
    const rows = db.select().from(customers).limit(1).all();
    expect(Array.isArray(rows)).toBe(true);
  });
});
