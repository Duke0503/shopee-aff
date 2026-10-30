import { eq } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { customers } from "../../../shared/database/schema";
import {
  asStaffRole,
  MIN_STAFF_PASSWORD_LENGTH,
  MIN_STAFF_USERNAME_LENGTH,
  type StaffRole,
} from "../domain/employee-account";
import { hashPassword } from "../domain/password-hash";

export type CreateEmployeeResult =
  | { ok: true; customerId: string; displayName: string; role: StaffRole }
  | { ok: false; reason: "username_too_short" | "password_too_short" | "username_taken" };

export interface NewEmployee {
  username: string;
  password: string;
  displayName?: string;
  role?: unknown;
}

/**
 * Ports `_admin_create_employee`. A staff account IS a customer row that can
 * sign into the console, so Identity owns the write; the plaintext password is
 * hashed here and never stored or returned.
 */
export function createEmployee(db: Db, input: NewEmployee, nowIso: string): CreateEmployeeResult {
  const username = (input.username ?? "").trim();
  const password = (input.password ?? "").trim();
  const displayName = (input.displayName ?? "").trim() || username;
  const role = asStaffRole(input.role);

  if (username.length < MIN_STAFF_USERNAME_LENGTH) return { ok: false, reason: "username_too_short" };
  if (password.length < MIN_STAFF_PASSWORD_LENGTH) return { ok: false, reason: "password_too_short" };

  const exists = db
    .select({ customerId: customers.customerId })
    .from(customers)
    .where(eq(customers.customerId, username))
    .get();
  if (exists) return { ok: false, reason: "username_taken" };

  db.insert(customers)
    .values({
      customerId: username,
      displayName,
      passwordHash: hashPassword(password),
      role,
      status: "active",
      createdAt: nowIso,
      passwordSetAt: nowIso,
    })
    .run();

  return { ok: true, customerId: username, displayName, role };
}
