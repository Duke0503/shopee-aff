/**
 * The admin commands on the internal listener (decision H8, AD-2, AD-18, AD-28, Story 4.20): the
 * internal CLI calls these with the internal token, so the server stays the one writer. Staff
 * screens come after cutover; until then staff are seeded, passwords reset, roles changed and a
 * cutover campaign created here, each preview first where it writes.
 *
 * The CLI signs in as an admin with name and password (the same argon2id check and doubling delay
 * as the desk, keyed by the fixed `internal-cli` identity instead of an Access identity) and sends
 * the session token in `x-staff-token`; only an admin passes. The first seed of an empty staff
 * table is the one call without it. Passwords arrive in request bodies, are hashed before the
 * transaction and are never stored, logged or answered; every command writes its audit entry.
 */
import {
  adminSignInRequestSchema,
  campaignRequestSchema,
  STAFF_TOKEN_HEADER,
  staffAccessRequestSchema,
  staffParamsSchema,
  staffPasswordRequestSchema,
  staffSeedPreviewRequestSchema,
  staffSeedRequestSchema,
  type CampaignInputBody,
  type CampaignPreviewResponse,
  type ErrorCode,
  type StaffSeedInput,
} from "@cashback/contracts";
import { formatVnDate, formatVnTime, type Clock } from "@cashback/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { z } from "zod";

import { CampaignCreateError, createCampaign, previewCampaign, type CampaignInput, type CampaignPreview } from "../modules/campaigns/index";
import { endSession, hashPassword, planStaffSeed, resetStaffPassword, resolveCustomer, seedStaff, setStaffAccess, signInStaff, STAFF_SEED_ACTOR, StaffAdminError, staffSessionOf, type SeedPlan, type StaffSeed } from "../modules/identity/index";
import { auditFor, commandAudit } from "../modules/operations/index";
import type { Ledger, LedgerDb } from "../platform/db/ledger";
import { HttpError } from "../platform/http/error-envelope";
import type { InternalRoutes } from "../platform/http/servers";
import type { Actor, CommandAudit } from "../platform/ports/audit.port";
import { staffActorOf } from "../platform/ports/staff-session.port";

/** The Access identity the internal CLI's sign-ins are throttled under. */
export const INTERNAL_CLI_SUBJECT = "internal-cli";

export interface AdminCommandDeps {
  readonly ledger: Ledger;
  readonly clock: Clock;
}

const STAFF_STATUS: Record<StaffAdminError["code"], ErrorCode> = { admin_only: "forbidden", root_differs: "conflict", username_taken: "conflict", password_required: "invalid_request", staff_not_found: "not_found", root_protected: "conflict" };
const CAMPAIGN_STATUS: Record<CampaignCreateError["code"], ErrorCode> = { admin_only: "forbidden", campaign_exists: "conflict", bad_window: "invalid_request", bad_field: "invalid_request" };

function parsed<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError("invalid_request", "error.invalid_request");
  return result.data;
}

function refusal(error: unknown): unknown {
  if (error instanceof StaffAdminError) return new HttpError(STAFF_STATUS[error.code], `error.staff.${error.code}`, error.staffId === undefined ? undefined : { staffId: error.staffId });
  if (error instanceof CampaignCreateError) return new HttpError(CAMPAIGN_STATUS[error.code], `error.campaign.${error.code}`, error.field === undefined ? undefined : { field: error.field });
  return error;
}

const staffToken = (request: FastifyRequest): string | null => {
  const value = request.headers[STAFF_TOKEN_HEADER];
  return typeof value === "string" ? value : null;
};

/** The signed-in admin behind the staff token; an employee is refused, no token is unauthorized. */
function adminActor(deps: AdminCommandDeps, request: FastifyRequest): Actor {
  const staff = staffSessionOf(deps.ledger.db, staffToken(request), deps.clock);
  if (staff === null) throw new HttpError("unauthorized", "error.unauthorized");
  if (staff.role !== "ADMIN") throw new HttpError("forbidden", "error.staff.admin_only");
  return staffActorOf(staff);
}

function inTx<T>(deps: AdminCommandDeps, actor: Actor, fn: (db: LedgerDb, by: CommandAudit) => T): T {
  try {
    return deps.ledger.tx((db) => fn(db, commandAudit(db, deps.clock, actor)));
  } catch (error) {
    throw refusal(error);
  }
}

const seedOf = (input: StaffSeedInput): StaffSeed => ({ root: input.root, members: input.members });

/** The seed's plan, read once, and who runs it: the admin, or the bootstrap actor while the staff table is empty. */
function seedRun(deps: AdminCommandDeps, request: FastifyRequest, seed: StaffSeed): { readonly actor: Actor; readonly plan: SeedPlan } {
  let plan: SeedPlan;
  try {
    plan = planStaffSeed(deps.ledger.db, seed);
  } catch (error) {
    throw refusal(error);
  }
  return { plan, actor: plan.bootstrap && staffToken(request) === null ? STAFF_SEED_ACTOR : adminActor(deps, request) };
}

/**
 * The hashes of exactly the members the plan creates. A password for anyone else (an existing
 * member, a stranger, more entries than the seed lists) is refused before anything is hashed, so
 * a request can never make the server hash an unbounded map.
 */
async function plannedHashes(plan: SeedPlan, passwords: Readonly<Record<string, string>>): Promise<Map<string, string>> {
  const planned = new Set(plan.create.map((m) => m.staffId));
  const given = Object.keys(passwords);
  if (given.length > planned.size || given.some((id) => !planned.has(id))) throw new HttpError("invalid_request", "error.staff.unexpected_password");
  const hashes = new Map<string, string>();
  for (const id of planned) {
    const password = passwords[id];
    if (password === undefined) throw new HttpError("invalid_request", "error.staff.password_required", { staffId: id });
    hashes.set(id, await hashPassword(password));
  }
  return hashes;
}

function campaignInput(db: LedgerDb, body: CampaignInputBody): CampaignInput {
  const excluded = body.excludedCustomers.map((key) => {
    const found = resolveCustomer(db, key);
    if (found === null) throw new CampaignCreateError("bad_field", "excludedCustomers");
    return found.customerId;
  });
  return { ...body, excludedCustomerIds: excluded };
}

function campaignAnswer(p: CampaignPreview, clock: Clock): CampaignPreviewResponse {
  return { ...p, platforms: [...p.platforms], excludedCustomerIds: [...p.excludedCustomerIds], endsBefore: { time: formatVnTime(p.endsAt), date: formatVnDate(p.endsAt, clock) } };
}

function sessionRoutes(app: FastifyInstance, deps: AdminCommandDeps): void {
  app.post("/internal/admin/session", async (request) => {
    const body = parsed(adminSignInRequestSchema, request.body);
    const result = await signInStaff(deps.ledger, { ...body, accessSubject: INTERNAL_CLI_SUBJECT }, { clock: deps.clock, auditFor: (db) => auditFor(db, deps.clock) });
    if (result.outcome === "refused") throw result.reason === "waiting" ? new HttpError("rate_limited", "error.staff_sign_in_waiting") : new HttpError("unauthorized", "error.staff_sign_in_refused");
    return { token: result.session.token, staffId: result.staff.staffId, role: result.staff.role, expiresAt: result.session.expiresAt };
  });
  app.delete("/internal/admin/session", async (request) => ({ signedOut: deps.ledger.tx((db) => endSession(db, staffToken(request), "SIGNED_OUT", deps.clock)) }));
}

function staffRoutes(app: FastifyInstance, deps: AdminCommandDeps): void {
  app.post("/internal/admin/staff/seed/preview", async (request) => {
    const seed = seedOf(parsed(staffSeedPreviewRequestSchema, request.body).seed);
    return seedRun(deps, request, seed).plan;
  });
  app.post("/internal/admin/staff/seed", async (request) => {
    const body = parsed(staffSeedRequestSchema, request.body);
    const seed = seedOf(body.seed);
    const { actor, plan } = seedRun(deps, request, seed);
    const hashes = await plannedHashes(plan, body.passwords);
    return inTx(deps, actor, (db, by) => seedStaff(db, seed, hashes, { clock: deps.clock, by }));
  });
  app.post("/internal/admin/staff/:staffId/password", async (request) => {
    const actor = adminActor(deps, request);
    const { staffId } = parsed(staffParamsSchema, request.params);
    const hash = await hashPassword(parsed(staffPasswordRequestSchema, request.body).password);
    return { staffId, ...inTx(deps, actor, (db, by) => resetStaffPassword(db, staffId, hash, { clock: deps.clock, by })) };
  });
  app.post("/internal/admin/staff/:staffId/access", async (request) => {
    const actor = adminActor(deps, request);
    const { staffId } = parsed(staffParamsSchema, request.params);
    const change = parsed(staffAccessRequestSchema, request.body);
    const row = inTx(deps, actor, (db, by) => setStaffAccess(db, staffId, change, { clock: deps.clock, by }));
    return { staffId: row.staffId, role: row.role, status: row.status };
  });
}

function campaignRoutes(app: FastifyInstance, deps: AdminCommandDeps): void {
  app.post("/internal/admin/campaigns/preview", async (request) => {
    adminActor(deps, request);
    const { campaign } = parsed(campaignRequestSchema, request.body);
    try {
      return campaignAnswer(previewCampaign(deps.ledger.db, campaignInput(deps.ledger.db, campaign)), deps.clock);
    } catch (error) {
      throw refusal(error);
    }
  });
  app.post("/internal/admin/campaigns", async (request) => {
    const actor = adminActor(deps, request);
    const { campaign } = parsed(campaignRequestSchema, request.body);
    return campaignAnswer(
      inTx(deps, actor, (db, by) => createCampaign(db, campaignInput(db, campaign), { clock: deps.clock, by })),
      deps.clock,
    );
  });
}

export function adminCommandRoutes(deps: AdminCommandDeps): InternalRoutes {
  return (app) => {
    sessionRoutes(app, deps);
    staffRoutes(app, deps);
    campaignRoutes(app, deps);
  };
}
