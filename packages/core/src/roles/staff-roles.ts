/**
 * Staff roles (FR-24, AD-18): the one definition the server, its tables and the contracts share.
 * An admin may do everything an employee may, plus the admin-only actions (staff accounts,
 * campaigns, payout void, forced erase).
 */
export const STAFF_ROLES = ["ADMIN", "EMPLOYEE"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
