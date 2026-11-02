/**
 * The staff accounts for the admin desk's staff screen (FR-24, Story 4.20): name, role, status and
 * the last sign-in, the root admin first. The password hash is never selected, so it cannot reach
 * an answer by accident.
 */
import { asc, desc } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import type { StaffRole } from "../../platform/ports/audit.port";
import { staff } from "./schema";

export interface StaffListRow {
  readonly staffId: string;
  readonly username: string;
  readonly role: StaffRole;
  readonly status: "ACTIVE" | "DISABLED";
  readonly root: boolean;
  readonly lastSignInAt: string | null;
  readonly createdAt: string;
}

export function staffList(db: LedgerDb): StaffListRow[] {
  return db
    .select({ staffId: staff.staffId, username: staff.username, role: staff.role, status: staff.status, root: staff.isRoot, lastSignInAt: staff.lastSignInAt, createdAt: staff.createdAt })
    .from(staff)
    .orderBy(desc(staff.isRoot), asc(staff.username))
    .all();
}

/** The root admin, whom every seed names; null before the first seed. */
export function rootStaff(db: LedgerDb): { readonly staffId: string; readonly username: string } | null {
  return staffList(db).find((s) => s.root) ?? null;
}
