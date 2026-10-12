import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { openDatabase, type Db } from "../../../shared/database/connection";
import { customers } from "../../../shared/database/schema";
import { verifyPassword } from "../domain/password-hash";
import { createEmployee } from "./create-employee.use-case";

const DDL = `CREATE TABLE customers (customer_id TEXT PRIMARY KEY, customer_code TEXT, zalo_user_id TEXT,
   private_chat_id TEXT, display_name TEXT, bank_name TEXT, bank_account TEXT, account_holder TEXT,
   consent_at TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL,
   password_hash TEXT, password_set_at TEXT, failed_logins INTEGER NOT NULL DEFAULT 0,
   locked_until TEXT, role TEXT NOT NULL DEFAULT 'user', last_login_at TEXT,
   login_count INTEGER NOT NULL DEFAULT 0)`;

const NOW = "2026-10-07T12:00:00";

const find = (db: Db, id: string) =>
  db.select().from(customers).where(eq(customers.customerId, id)).get();

describe("createEmployee", () => {
  let db: Db;
  beforeEach(() => {
    db = openDatabase({ path: ":memory:" });
    db.run(sql.raw(DDL));
  });

  it("creates an active employee with a hashed password", () => {
    const result = createEmployee(db, { username: "EMP9", password: "secret1", displayName: "Helper" }, NOW);

    expect(result).toEqual({ ok: true, customerId: "EMP9", displayName: "Helper", role: "employee" });
    const row = find(db, "EMP9");
    expect(row).toMatchObject({
      role: "employee",
      status: "active",
      displayName: "Helper",
      createdAt: NOW,
      passwordSetAt: NOW,
    });
    expect(verifyPassword("secret1", row?.passwordHash)).toBe(true);
    expect(row?.passwordHash).not.toContain("secret1");
  });

  it("defaults the display name to the login and an unknown role to employee", () => {
    const result = createEmployee(db, { username: "EMP2", password: "secret1", role: "boss" }, NOW);
    expect(result).toMatchObject({ ok: true, displayName: "EMP2", role: "employee" });
  });

  it("creates a second admin only when explicitly asked", () => {
    expect(createEmployee(db, { username: "BOSS", password: "secret1", role: "admin" }, NOW)).toMatchObject({
      role: "admin",
    });
  });

  it("refuses a short login, a short password and a taken login", () => {
    expect(createEmployee(db, { username: "ab", password: "secret1" }, NOW)).toEqual({
      ok: false,
      reason: "username_too_short",
    });
    expect(createEmployee(db, { username: "EMP3", password: "123" }, NOW)).toEqual({
      ok: false,
      reason: "password_too_short",
    });

    createEmployee(db, { username: "EMP4", password: "secret1" }, NOW);
    expect(createEmployee(db, { username: "EMP4", password: "secret1" }, NOW)).toEqual({
      ok: false,
      reason: "username_taken",
    });
  });
});
