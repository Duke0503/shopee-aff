/**
 * Staff accounts by admin command (AD-18, AD-28, D21, D53, FR-24, INV-8; Story 4.20). There is no
 * staff screen in v1: the owner seeds the staff from a list and resets passwords or changes roles
 * through the internal CLI. Every command is one transaction with its audit entry.
 *
 * Seeding creates the root admin and the listed members that do not exist yet and changes nobody
 * who does, so a rerun writes no staff row. On an empty staff table it may run before any admin
 * exists (the bootstrap, under the `staff-seed` system actor); once staff exist only an admin may
 * run it. The root admin is never demoted or disabled (the database refuses it too). A new
 * password and a disabled account end every open session of that member (D21). Passwords reach
 * these commands only as argon2id hashes made before the transaction; no password is stored,
 * logged or audited.
 */
import type { Clock } from "@cashback/core";
import { and, eq, isNull } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { hasStaffRole, type Actor, type CommandAudit, type StaffRole } from "../../platform/ports/audit.port";
import { sessions, staff, type SessionEndReason, type StaffRow } from "./schema";

/** The actor of the first seed, when no staff member exists yet to sign in. */
export const STAFF_SEED_ACTOR: Actor = { kind: "system", id: "staff-seed" };

/** The shortest password a seeded or reset account may get. */
export const MIN_STAFF_PASSWORD = 12;

export type StaffAdminErrorCode = "admin_only" | "root_differs" | "username_taken" | "password_required" | "staff_not_found" | "root_protected";

export class StaffAdminError extends Error {
  constructor(
    readonly code: StaffAdminErrorCode,
    readonly staffId?: string,
  ) {
    super(`staff command: ${code}${staffId === undefined ? "" : ` (${staffId})`}`);
    this.name = "StaffAdminError";
  }
}

export interface SeedMember {
  readonly staffId: string;
  readonly username: string;
  readonly role: StaffRole;
}

export interface StaffSeed {
  /** The root admin: always an active ADMIN. */
  readonly root: Omit<SeedMember, "role">;
  readonly members: readonly SeedMember[];
}

export interface SeedPlan {
  /** True when no staff member exists: the seed may run without an admin. */
  readonly bootstrap: boolean;
  readonly create: readonly (SeedMember & { readonly root: boolean })[];
  readonly unchanged: readonly string[];
}

interface Deps {
  readonly clock: Clock;
  readonly by: CommandAudit;
}

const staffById = (db: LedgerDb, staffId: string): StaffRow | undefined => db.select().from(staff).where(eq(staff.staffId, staffId)).get();
const staffCount = (db: LedgerDb): number => db.select({ id: staff.staffId }).from(staff).all().length;

function requireAdmin(actor: Actor): void {
  if (!hasStaffRole(actor, ["ADMIN"])) throw new StaffAdminError("admin_only");
}

/** What a seed would do, written nowhere; the CLI asks a password only for the members it creates. */
export function planStaffSeed(db: LedgerDb, seed: StaffSeed): SeedPlan {
  const root = db.select().from(staff).where(eq(staff.isRoot, true)).get();
  if (root !== undefined && root.staffId !== seed.root.staffId) throw new StaffAdminError("root_differs", seed.root.staffId);
  const wanted = [{ ...seed.root, role: "ADMIN" as const, root: true }, ...seed.members.map((m) => ({ ...m, root: false }))];
  const create: SeedPlan["create"][number][] = [];
  const unchanged: string[] = [];
  for (const member of wanted) {
    if (staffById(db, member.staffId) !== undefined) {
      unchanged.push(member.staffId);
      continue;
    }
    const named = db.select().from(staff).where(eq(staff.username, member.username)).get();
    if (named !== undefined || create.some((c) => c.username === member.username)) throw new StaffAdminError("username_taken", member.staffId);
    create.push(member);
  }
  return { bootstrap: staffCount(db) === 0, create, unchanged };
}

/** Seeds the staff; `hashes` holds the argon2id hash of each member the plan creates. Run inside `tx`. */
export function seedStaff(db: LedgerDb, seed: StaffSeed, hashes: ReadonlyMap<string, string>, deps: Deps): SeedPlan {
  const plan = planStaffSeed(db, seed);
  if (!plan.bootstrap) requireAdmin(deps.by.actor);
  const now = deps.clock.now();
  for (const member of plan.create) {
    const hash = hashes.get(member.staffId);
    if (hash === undefined) throw new StaffAdminError("password_required", member.staffId);
    db.insert(staff).values({ staffId: member.staffId, username: member.username, role: member.role, status: "ACTIVE", isRoot: member.root, passwordHash: hash, passwordSetAt: now, createdAt: now }).run();
    deps.by.audit.record({ actor: deps.by.actor, event: "identity.staff.seeded", entityId: member.staffId, payload: { staffId: member.staffId, role: member.role, root: member.root } });
  }
  deps.by.audit.record({ actor: deps.by.actor, event: "identity.staff.seed_ran", entityId: seed.root.staffId, payload: { created: plan.create.length, unchanged: plan.unchanged.length, bootstrap: plan.bootstrap } });
  return plan;
}

function endSessionsOf(db: LedgerDb, staffId: string, reason: SessionEndReason, clock: Clock): number {
  return db
    .update(sessions)
    .set({ endedAt: clock.now(), endReason: reason })
    .where(and(eq(sessions.staffId, staffId), isNull(sessions.endedAt)))
    .run().changes;
}

/** A new password for a staff member; every open session of theirs ends (D21). */
export function resetStaffPassword(db: LedgerDb, staffId: string, hash: string, deps: Deps): { readonly sessionsEnded: number } {
  requireAdmin(deps.by.actor);
  if (staffById(db, staffId) === undefined) throw new StaffAdminError("staff_not_found", staffId);
  db.update(staff).set({ passwordHash: hash, passwordSetAt: deps.clock.now() }).where(eq(staff.staffId, staffId)).run();
  const sessionsEnded = endSessionsOf(db, staffId, "NEW_PASSWORD", deps.clock);
  deps.by.audit.record({ actor: deps.by.actor, event: "identity.staff.password_reset", entityId: staffId, payload: { staffId, sessionsEnded } });
  return { sessionsEnded };
}

export interface StaffAccess {
  readonly role?: StaffRole;
  readonly status?: "ACTIVE" | "DISABLED";
}

/** Changes a member's role or status; the root admin stays an active admin. A disabled member's sessions end. */
export function setStaffAccess(db: LedgerDb, staffId: string, change: StaffAccess, deps: Deps): StaffRow {
  requireAdmin(deps.by.actor);
  const current = staffById(db, staffId);
  if (current === undefined) throw new StaffAdminError("staff_not_found", staffId);
  const role = change.role ?? current.role;
  const status = change.status ?? current.status;
  if (current.isRoot && (role !== "ADMIN" || status !== "ACTIVE")) throw new StaffAdminError("root_protected", staffId);
  db.update(staff).set({ role, status }).where(eq(staff.staffId, staffId)).run();
  const sessionsEnded = status === "DISABLED" ? endSessionsOf(db, staffId, "STAFF_DISABLED", deps.clock) : 0;
  deps.by.audit.record({ actor: deps.by.actor, event: "identity.staff.access_changed", entityId: staffId, payload: { staffId, fromRole: current.role, role, fromStatus: current.status, status, sessionsEnded } });
  return staffById(db, staffId) ?? current;
}
