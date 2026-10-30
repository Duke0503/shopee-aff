/**
 * Stories 2.3 and 2.5: the orders, linking and messaging Drizzle definitions match migrations
 * 0002 to 0004 column by column, so a write through a module's schema.ts lands in the tables the
 * migration made, and every table has exactly one owner (AD-4).
 */
import { join } from "node:path";
import { fixedClock } from "@cashback/core";
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import * as identity from "../src/modules/identity/schema";
import * as linking from "../src/modules/linking/schema";
import * as messaging from "../src/modules/messaging/schema";
import * as orders from "../src/modules/orders/schema";
import { openLedger } from "../src/platform/db/ledger";
import { MIGRATIONS_DIR, readMigrations, runMigrations } from "../src/platform/db/migrations";
import { tempDir } from "./helpers/live-fixture";

interface Column {
  name: string;
  notnull: number;
  pk: number;
}

const tablesOf = (schema: Record<string, unknown>): SQLiteTable[] => Object.values(schema).filter((v): v is SQLiteTable => typeof v === "object" && v !== null && Symbol.for("drizzle:IsDrizzleTable") in v);

const OWNERS = { identity, linking, messaging, orders };

describe("module schemas (Stories 2.3, 2.5, AD-4)", () => {
  const ledger = openLedger(join(tempDir("cashback-module-schemas-"), "ledger.sqlite"));
  runMigrations(ledger, readMigrations(MIGRATIONS_DIR), fixedClock("2026-10-30T00:00:00.000Z"));

  for (const table of [orders, linking, messaging].flatMap(tablesOf)) {
    const config = getTableConfig(table);
    it(`${config.name} has the migration's columns, keys and NOT NULLs`, () => {
      const live = ledger.sqlite.prepare('SELECT name, "notnull", pk FROM pragma_table_info(?) ORDER BY cid').all(config.name) as Column[];
      const primary = new Set(config.primaryKeys.flatMap((k) => k.columns.map((c) => c.name)));
      const fromSql = live.map((c) => ({ name: c.name, notNull: c.notnull === 1 || c.pk > 0, primary: c.pk > 0 }));
      const fromDrizzle = config.columns.map((c) => ({ name: c.name, notNull: c.notNull, primary: c.primary || primary.has(c.name) }));
      expect(fromDrizzle).toEqual(fromSql);
    });
  }

  it("every migrated table is declared in exactly one module's schema.ts", () => {
    const declared = Object.entries(OWNERS).flatMap(([owner, schema]) => tablesOf(schema).map((t) => [getTableConfig(t).name, owner]));
    const names = declared.map(([name]) => name);
    expect(new Set(names).size).toBe(names.length);
    const migrated = (ledger.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    expect([...names].sort()).toEqual(migrated);
    expect(Object.fromEntries(declared.filter(([, owner]) => owner !== "identity"))).toEqual({
      orders: "orders",
      order_items: "orders",
      order_status_history: "orders",
      order_observations: "orders",
      settlement_periods: "orders",
      product_offers: "linking",
      link_requests: "linking",
      share_codes: "linking",
      outbox: "messaging",
    });
  });
});
