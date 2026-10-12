import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { openDatabase, type Db } from "../../../shared/database/connection";
import { customers } from "../../../shared/database/schema";
import { hashPassword, verifyPassword } from "../domain/password-hash";
import { updateEmployee } from "./update-employee.use-case";

const DDL = `CREATE TABLE customers (customer_id TEXT PRIMARY KEY, customer_code TEXT, zalo_user_id TEXT,
   private_chat_id TEXT, display_name TEXT, bank_name TEXT, bank_account TEXT, account_holder TEXT,
   consent_at TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL,
   password_hash TEXT, password_set_at TEXT, failed_logins INTEGER NOT NULL DEFAULT 0,
   locked_until TEXT, role TEXT NOT NULL DEFAULT 'user', last_login_at TEXT,
   login_count INTEGER NOT NULL DEFAULT 0)`;

const NOW = "2026-10-07T12:00:00";

const find = (db: Db, id: string) =>
  db.select().from(customers).where(eq(customers.customerId, id)).get();

function seed(db: Db, id: string, role: string, password: string): void {
  db.insert(customers)
    .values({
      customerId: id,
      displayName: id,
      role,
      status: "active",
      createdAt: "2026-01-01T00:00:00",
      passwordHash: hashPassword(password, "s1"),
      passwordSetAt: "2026-01-01T00:00:00",
    })
    .run();
}

describe("updateEmployee", () => {
  let db: Db;
  beforeEach(() => {
    db = openDatabase({ path: ":memory:" });
    db.run(sql.raw(DDL));
    seed(db, "admin", "admin", "ADMINPASS");
    seed(db, "EMP1", "employee", "oldpass1");
  });

  it("changes role, status and password together", () => {
    const result = updateEmployee(
      db,
      { customerId: "EMP1", role: "admin", status: "disabled", newPassword: "newpass1" },
      NOW,
    );

    expect(result).toEqual({ ok: true, updated: true });
    const row = find(db, "EMP1");
    expect(row).toMatchObject({ role: "admin", status: "disabled", passwordSetAt: NOW });
    expect(verifyPassword("newpass1", row?.passwordHash)).toBe(true);
  });

  it("ignores a too-short new password but still applies the rest", () => {
    const result = updateEmployee(db, { customerId: "EMP1", status: "disabled", newPassword: "123" }, NOW);

    expect(result).toEqual({ ok: true, updated: true });
    const row = find(db, "EMP1");
    expect(row?.status).toBe("disabled");
    expect(verifyPassword("oldpass1", row?.passwordHash)).toBe(true);
  });

  it("never demotes or disables the root admin", () => {
    expect(updateEmployee(db, { customerId: "admin", role: "employee" }, NOW)).toEqual({
      ok: false,
      reason: "root_admin_locked",
    });
    expect(updateEmployee(db, { customerId: "admin", status: "disabled" }, NOW)).toEqual({
      ok: false,
      reason: "root_admin_locked",
    });
    expect(find(db, "admin")).toMatchObject({ role: "admin", status: "active" });
  });

  it("reports a missing employee and does nothing when there is no change", () => {
    expect(updateEmployee(db, { customerId: "nobody" }, NOW)).toEqual({ ok: false, reason: "not_found" });
    expect(updateEmployee(db, { customerId: "EMP1" }, NOW)).toEqual({ ok: true, updated: false });
  });
});
