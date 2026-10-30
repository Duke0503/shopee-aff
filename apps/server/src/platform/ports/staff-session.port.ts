/**
 * The staff session port (AD-18, INV-8): how the staff route group in platform/http learns who
 * holds a staff cookie, without importing the identity module that implements it over the
 * `sessions` and `staff` tables. Only an open, unexpired STAFF session of an ACTIVE staff member
 * resolves; a customer session never does.
 */
import type { Actor, StaffRole } from "./audit.port";

export interface StaffPrincipal {
  readonly staffId: string;
  readonly username: string;
  readonly role: StaffRole;
}

export interface StaffSessionPort {
  resolve(token: string | null): StaffPrincipal | null;
}

/** The actor a staff route passes to the commands it calls (AD-17). */
export const staffActorOf = (staff: StaffPrincipal): Actor => ({ kind: "staff", id: staff.staffId, role: staff.role });
