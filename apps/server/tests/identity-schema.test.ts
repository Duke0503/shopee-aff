/**
 * Story 2.2: the identity Drizzle definitions match migrations/0001_identity.sql column by
 * column, so a write through schema.ts lands in the tables the migration made.
 */
import { join } from "node:path";
import { fixedClock } from "@cashback/core";
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import { bankAccounts, customerAliases, customerCodeCounter, customers } from "../src/modules/identity/schema";
import { openLedger } from "../src/platform/db/ledger";
import { MIGRATIONS_DIR, readMigrations, runMigrations } from "../src/platform/db/migrations";
import { tempDir } from "./helpers/live-fixture";

interface Column {
  name: string;
  notnull: number;
  pk: number;
}

describe("identity schema (Story 2.2, AD-4)", () => {
  const ledger = openLedger(join(tempDir("cashback-identity-schema-"), "ledger.sqlite"));
  runMigrations(ledger, readMigrations(MIGRATIONS_DIR), fixedClock("2026-10-30T00:00:00.000Z"));

  for (const table of [customers, customerAliases, customerCodeCounter, bankAccounts] as SQLiteTable[]) {
    const config = getTableConfig(table);
    it(`${config.name} has the migration's columns, keys and NOT NULLs`, () => {
      const live = ledger.sqlite.prepare("SELECT name, \"notnull\", pk FROM pragma_table_info(?) ORDER BY cid").all(config.name) as Column[];
      const fromSql = live.map((c) => ({ name: c.name, notNull: c.notnull === 1, primary: c.pk > 0 }));
      const fromDrizzle = config.columns.map((c) => ({ name: c.name, notNull: c.notNull, primary: c.primary }));
      expect(fromDrizzle).toEqual(fromSql);
    });
  }
});
