/**
 * The staff screen on the admin desk (FR-24, AD-18, D21, INV-8; Story 4.20 after cutover). The same
 * identity commands as the internal CLI, each one transaction with its audit entry: adding a member
 * is a seed of the root admin and that one member, a role or status change is `setStaffAccess`, a
 * new password is `resetStaffPassword`. Every path is in ADMIN_ONLY_PATHS.
 *
 *   GET  /api/admin/staff                      the accounts, never a hash
 *   POST /api/admin/staff                      add a member; answers the issued password once
 *   POST /api/admin/staff/:staffId/access      change role or status (the root admin stays an active admin)
 *   POST /api/admin/staff/:staffId/password    issue a new password, answered once; the member's sessions end
 *
 * The server makes each password (16 characters from the unambiguous alphabet) and hashes it
 * before the transaction; only the hash is stored and nothing logs or audits the password.
 */
import { staffAccessRequestSchema, staffAccessResponseSchema, staffAddRequestSchema, staffIssuedPasswordSchema, staffListSchema, staffParamsSchema, type StaffIssuedPassword } from "@cashback/contracts";
import type { Clock } from "@cashback/core";
import type { FastifyRequest } from "fastify";
import type { z } from "zod";

import { hashPassword, issuedPassword, resetStaffPassword, rootStaff, seedStaff, setStaffAccess, StaffAdminError, staffList } from "../modules/identity/index";
import { commandAudit } from "../modules/operations/index";
import type { Ledger, LedgerDb } from "../platform/db/ledger";
import { HttpError } from "../platform/http/error-envelope";
import type { StaffRequest, StaffRoutes } from "../platform/http/staff-routes";
import type { CommandAudit } from "../platform/ports/audit.port";
import { staffActorOf } from "../platform/ports/staff-session.port";
import { refusal } from "./admin-command.routes";

export interface StaffDeskRouteDeps {
  readonly ledger: Ledger;
  readonly clock: Clock;
}

/** Long enough to be typed once and changed; above the 12-character staff minimum. */
export const ISSUED_STAFF_PASSWORD_CHARS = 16;

function parsed<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError("invalid_request", "error.invalid_request");
  return result.data;
}

/** The staff id a new member gets from the sign-in name: the CLI's id rule, with dots and underscores as dashes. */
export const staffIdFor = (username: string): string => `s-${username.replace(/[._]/g, "-")}`.slice(0, 40);

function inTx<T>(deps: StaffDeskRouteDeps, context: StaffRequest, fn: (db: LedgerDb, by: CommandAudit) => T): T {
  if (context.staff === null) throw new HttpError("unauthorized", "error.unauthorized");
  const actor = staffActorOf(context.staff);
  try {
    return deps.ledger.tx((db) => fn(db, commandAudit(db, deps.clock, actor)));
  } catch (error) {
    throw refusal(error);
  }
}

async function addMember(deps: StaffDeskRouteDeps, request: FastifyRequest, context: StaffRequest): Promise<StaffIssuedPassword> {
  const { username, role } = parsed(staffAddRequestSchema, request.body);
  const root = rootStaff(deps.ledger.db);
  if (root === null) throw new HttpError("conflict", "error.staff.no_root");
  const staffId = staffIdFor(username);
  const password = issuedPassword(ISSUED_STAFF_PASSWORD_CHARS);
  const hash = await hashPassword(password);
  inTx(deps, context, (db, by) => {
    const plan = seedStaff(db, { root, members: [{ staffId, username, role }] }, new Map([[staffId, hash]]), { clock: deps.clock, by });
    // An id already taken (by another name that maps to it) creates nobody: refused, and the seed's audit entry rolls back.
    if (!plan.create.some((m) => m.staffId === staffId)) throw new StaffAdminError("username_taken", staffId);
  });
  return { staffId, username, password, sessionsEnded: 0 };
}

async function newPassword(deps: StaffDeskRouteDeps, request: FastifyRequest, context: StaffRequest): Promise<StaffIssuedPassword> {
  const { staffId } = parsed(staffParamsSchema, request.params);
  const member = staffList(deps.ledger.db).find((s) => s.staffId === staffId);
  if (member === undefined) throw new HttpError("not_found", "error.staff.staff_not_found", { staffId });
  const password = issuedPassword(ISSUED_STAFF_PASSWORD_CHARS);
  const hash = await hashPassword(password);
  const { sessionsEnded } = inTx(deps, context, (db, by) => resetStaffPassword(db, staffId, hash, { clock: deps.clock, by }));
  return { staffId, username: member.username, password, sessionsEnded };
}

export function staffDeskRoutes(deps: StaffDeskRouteDeps): StaffRoutes {
  return (add) => {
    add({ method: "GET", url: "/api/admin/staff", adminOnly: true, handler: async () => staffListSchema.parse({ staff: staffList(deps.ledger.db) }) });
    add({ method: "POST", url: "/api/admin/staff", adminOnly: true, handler: async (request, _reply, context) => staffIssuedPasswordSchema.parse(await addMember(deps, request, context)) });
    add({
      method: "POST",
      url: "/api/admin/staff/:staffId/access",
      adminOnly: true,
      handler: async (request, _reply, context) => {
        const { staffId } = parsed(staffParamsSchema, request.params);
        const change = parsed(staffAccessRequestSchema, request.body);
        const row = inTx(deps, context, (db, by) => setStaffAccess(db, staffId, change, { clock: deps.clock, by }));
        return staffAccessResponseSchema.parse({ staffId: row.staffId, role: row.role, status: row.status });
      },
    });
    add({ method: "POST", url: "/api/admin/staff/:staffId/password", adminOnly: true, handler: async (request, _reply, context) => staffIssuedPasswordSchema.parse(await newPassword(deps, request, context)) });
  };
}
