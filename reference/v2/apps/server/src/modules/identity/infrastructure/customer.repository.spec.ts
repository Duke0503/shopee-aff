import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { openDatabase, type Db } from "../../../shared/database/connection";
import { findCustomerIdByAnyId } from "./customer.repository";

const UID = "8461752093318820417";

function makeDb(): Db {
  const db = openDatabase({ path: ":memory:" });
  db.run(
    sql`CREATE TABLE customers (customer_id TEXT PRIMARY KEY, customer_code TEXT,
        zalo_user_id TEXT, role TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL)`,
  );
  db.run(
    sql`CREATE TABLE customer_aliases (alias TEXT PRIMARY KEY, customer_id TEXT NOT NULL,
        created_at TEXT NOT NULL)`,
  );
  db.run(
    sql`INSERT INTO customers (customer_id, customer_code, zalo_user_id, created_at)
        VALUES (${UID}, 'DP00012', ${UID}, 't')`,
  );
  db.run(sql`INSERT INTO customers (customer_id, created_at) VALUES ('C0036', 't')`);
  db.run(
    sql`INSERT INTO customer_aliases (alias, customer_id, created_at)
        VALUES ('OLD999', ${UID}, 't')`,
  );
  db.run(
    sql`INSERT INTO customer_aliases (alias, customer_id, created_at)
        VALUES ('DP00007', ${UID}, 't')`,
  );
  return db;
}

describe("findCustomerIdByAnyId (matches Python find_customer_id)", () => {
  let db: Db;
  let found: (key: string) => string | null;

  beforeEach(() => {
    db = makeDb();
    found = (key) => findCustomerIdByAnyId(db, key);
  });

  it("finds by internal id / Zalo UID", () => {
    expect(found(UID)).toBe(UID);
  });

  it("finds by DP code in any case", () => {
    expect(found("DP00012")).toBe(UID);
    expect(found("dp00012")).toBe(UID);
  });

  it("ignores surrounding and internal spaces", () => {
    expect(found("  dp 00012 ")).toBe(UID);
  });

  it("finds a legacy hand-made id", () => {
    expect(found("C0036")).toBe("C0036");
  });

  it("follows an old-id alias to the surviving customer", () => {
    expect(found("OLD999")).toBe(UID);
  });

  it("follows a retired DP code alias", () => {
    expect(found("DP00007")).toBe(UID);
  });

  it("returns null for unknown or empty input — never a guest", () => {
    expect(found("DP99999")).toBeNull();
    expect(found("")).toBeNull();
    expect(found("   ")).toBeNull();
  });
});
