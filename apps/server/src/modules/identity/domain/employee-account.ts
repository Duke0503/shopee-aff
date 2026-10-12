/**
 * Rules for staff accounts in the admin console. Ports `_admin_create_employee`
 * and `_admin_update_employee` in `web/dashboard.py`, including the guard that
 * keeps the founding `admin` account from being demoted or disabled.
 */

/** Shorter than this and the admin-created login is refused. */
export const MIN_STAFF_USERNAME_LENGTH = 3;

/**
 * The console minimum, which is deliberately looser than the 8 characters an
 * issued customer password gets (an admin types a staff password by hand).
 */
export const MIN_STAFF_PASSWORD_LENGTH = 6;

export const STAFF_ROLES = ["admin", "employee"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const STAFF_STATUSES = ["active", "disabled"] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

/** The founding account; it must keep admin rights and stay active. */
export const ROOT_ADMIN_ID = "admin";

export function isStaffRole(value: unknown): value is StaffRole {
  return value === "admin" || value === "employee";
}

export function isStaffStatus(value: unknown): value is StaffStatus {
  return value === "active" || value === "disabled";
}

/** An unknown role still creates an employee, never a second admin. */
export function asStaffRole(value: unknown): StaffRole {
  return isStaffRole(value) ? value : "employee";
}

/** True when a change would lock everyone out of the console. */
export function locksOutRootAdmin(targetId: string, role: unknown, status: unknown): boolean {
  return targetId === ROOT_ADMIN_ID && (role === "employee" || status === "disabled");
}
