import { eq } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { customers } from "../../../shared/database/schema";
import {
  isStaffRole,
  isStaffStatus,
  locksOutRootAdmin,
  MIN_STAFF_PASSWORD_LENGTH,
} from "../domain/employee-account";
import { hashPassword } from "../domain/password-hash";

export type UpdateEmployeeResult =
  | { ok: true; updated: boolean }
  | { ok: false; reason: "not_found" | "root_admin_locked" };

export interface EmployeeChange {
  customerId: string;
  role?: unknown;
  status?: unknown;
  newPassword?: unknown;
}

/**
 * Ports `_admin_update_employee`: change a staff member's role, status and
 * password. The founding `admin` account can never be demoted or disabled, so
 * nobody can lock themselves out of the console. A new password shorter than
 * the console minimum is ignored, exactly as the Python did.
 */
export function updateEmployee(db: Db, change: EmployeeChange, nowIso: string): UpdateEmployeeResult {
  const customerId = (change.customerId ?? "").trim();
  const target = db
    .select({ customerId: customers.customerId })
    .from(customers)
    .where(eq(customers.customerId, customerId))
    .get();
  if (!target) return { ok: false, reason: "not_found" };
  if (locksOutRootAdmin(customerId, change.role, change.status)) {
    return { ok: false, reason: "root_admin_locked" };
  }

  const patch: Partial<typeof customers.$inferInsert> = {};
  if (isStaffRole(change.role)) patch.role = change.role;
  if (isStaffStatus(change.status)) patch.status = change.status;

  const password = typeof change.newPassword === "string" ? change.newPassword.trim() : "";
  if (password.length >= MIN_STAFF_PASSWORD_LENGTH) {
    patch.passwordHash = hashPassword(password);
    patch.passwordSetAt = nowIso;
  }

  if (Object.keys(patch).length === 0) return { ok: true, updated: false };
  db.update(customers).set(patch).where(eq(customers.customerId, customerId)).run();
  return { ok: true, updated: true };
}
