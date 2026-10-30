/**
 * Who holds a staff cookie (AD-18, INV-8): the open, unexpired STAFF session of an ACTIVE staff
 * member, with the role read from the staff row on every request, so a disabled or demoted
 * member loses access at once. A customer session resolves to nobody here, whichever cookie it
 * arrives in.
 */
import type { Clock } from "@cashback/core";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import type { StaffPrincipal, StaffSessionPort } from "../../platform/ports/staff-session.port";
import { sessions, staff } from "./schema";
import { sessionTokenHash } from "./session-token";

export function staffSessionOf(db: LedgerDb, token: string | null, clock: Clock): StaffPrincipal | null {
  const tokenHash = sessionTokenHash(token);
  if (tokenHash === null) return null;
  const found = db
    .select({ staffId: staff.staffId, username: staff.username, role: staff.role })
    .from(sessions)
    .innerJoin(staff, eq(staff.staffId, sessions.staffId))
    .where(and(eq(sessions.tokenHash, tokenHash), eq(sessions.kind, "STAFF"), isNull(sessions.endedAt), gt(sessions.expiresAt, clock.now()), eq(staff.status, "ACTIVE")))
    .get();
  return found ?? null;
}

/** The staff session port over the ledger (platform/ports/staff-session.port.ts). */
export function staffSessionsFor(db: LedgerDb, clock: Clock): StaffSessionPort {
  return { resolve: (token) => staffSessionOf(db, token, clock) };
}

/** Each staff member's sign-in name by staff id, for "<name> is paying" on a claimed payout (Story 4.6). */
export function staffNamesOf(db: LedgerDb, staffIds: readonly string[]): Map<string, string> {
  if (staffIds.length === 0) return new Map();
  const rows = db.select({ staffId: staff.staffId, username: staff.username }).from(staff).where(inArray(staff.staffId, [...new Set(staffIds)])).all();
  return new Map(rows.map((r) => [r.staffId, r.username]));
}
