/**
 * The staff route group (AD-18, D48, INV-8, review H8). Every staff route is registered only for
 * `Host` = the admin host, so `hoantiendp.com/api/admin/*` does not exist (404), and every one
 * checks, in this order, before its handler runs:
 *
 * 1. the Cloudflare Access JWT (401 without a valid one, whatever cookie comes with it);
 * 2. for a request that changes something, an Origin of the admin host itself (403);
 * 3. the staff session from the staff cookie only (401; a customer session never resolves);
 * 4. the admin role for an admin-only action (403), checked here on the server.
 *
 * Sign-in and sign-out are the routes without a session (sign-out must work with an expired
 * one); they still need the Access JWT and the Origin. Every handler gets the verified Access
 * identity. The group is absent when the config has no staff access settings. Responses are
 * never cached. A JPEG or PNG body arrives as raw bytes for the one route that takes it (its own
 * `bodyLimit`); every other route still refuses anything over the listener's 64 KB.
 */
import { PROOF_TYPES } from "@cashback/contracts";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { StaffPrincipal, StaffSessionPort } from "../ports/staff-session.port";
import { ACCESS_JWT_HEADER, verifyAccessJwt, type AccessCheck, type AccessIdentity } from "./access-jwt.guard";
import { HttpError } from "./error-envelope";
import { readCookie, STAFF_SESSION_COOKIE } from "./session-cookie";

export const STAFF_PATH_PREFIX = "/api/admin/";

/**
 * The admin-only actions of FR-24 by path: staff accounts, campaigns, payout void and forced
 * erase. A route on one of these paths is refused at registration unless it is `adminOnly`, so a
 * later story cannot open one to employees by forgetting the flag.
 */
export const ADMIN_ONLY_PATHS: readonly RegExp[] = [/^\/api\/admin\/staff(\/|$)/, /^\/api\/admin\/campaigns(\/|$)/, /^\/api\/admin\/payouts\/[^/]+\/void$/, /^\/api\/admin\/customers\/[^/]+\/force-erase$/];

export interface StaffGate {
  readonly adminHost: string;
  readonly access: AccessCheck;
  readonly sessions: StaffSessionPort;
}

export interface StaffRoute {
  readonly method: "GET" | "POST" | "DELETE";
  /** Starts with /api/admin/. */
  readonly url: string;
  /** False only for sign-in and sign-out; the Access JWT and Origin are checked either way. */
  readonly session?: boolean;
  /** Admin-only actions (FR-24): staff accounts, campaigns, payout void, forced erase. */
  readonly adminOnly?: boolean;
  /** A route that takes an image body (a payout proof) raises the listener's 64 KB limit to this. */
  readonly bodyLimit?: number;
  /** The message key of the refusal when the body passes `bodyLimit` (otherwise the generic invalid request). */
  readonly tooLargeKey?: string;
  readonly handler: (request: FastifyRequest, reply: FastifyReply, context: StaffRequest) => Promise<unknown>;
}

export interface StaffRequest {
  /** Null only on a route with `session: false`. */
  readonly staff: StaffPrincipal | null;
  /** Who passed Cloudflare Access for this request. */
  readonly access: AccessIdentity;
}

/** A module's staff routes, added to the group by the composition root. */
export type StaffRoutes = (add: (route: StaffRoute) => void) => void;

const unauthorized = (): HttpError => new HttpError("unauthorized", "error.unauthorized");
const forbidden = (): HttpError => new HttpError("forbidden", "error.forbidden");

async function accessOf(request: FastifyRequest, check: AccessCheck): Promise<AccessIdentity | null> {
  try {
    return await verifyAccessJwt(request.headers[ACCESS_JWT_HEADER], check);
  } catch (error) {
    request.log.warn({ code: (error as { code?: unknown }).code ?? "access_check_failed" }, "http.staff.access_unverified");
    return null;
  }
}

function guard(gate: StaffGate, route: StaffRoute, contexts: WeakMap<FastifyRequest, StaffRequest>) {
  const origin = `https://${gate.adminHost}`;
  return async (request: FastifyRequest): Promise<void> => {
    const access = await accessOf(request, gate.access);
    if (access === null) throw unauthorized();
    if (route.method !== "GET" && request.headers.origin !== origin) throw forbidden();
    if (route.session === false) {
      contexts.set(request, { staff: null, access });
      return;
    }
    const staff = gate.sessions.resolve(readCookie(request.headers.cookie, STAFF_SESSION_COOKIE));
    if (staff === null) throw unauthorized();
    if (route.adminOnly === true && staff.role !== "ADMIN") throw forbidden();
    contexts.set(request, { staff, access });
  };
}

/** Turns the body limit's 413 into the route's own refusal; any other error goes on to the listener's handler. */
const tooLarge =
  (messageKey: string) =>
  (error: FastifyError): never => {
    if (error.statusCode === 413) throw new HttpError("invalid_request", messageKey);
    throw error;
  };

export function registerStaffRoutes(app: FastifyInstance, gate: StaffGate, routes: readonly StaffRoutes[]): void {
  const contexts = new WeakMap<FastifyRequest, StaffRequest>();
  if (!app.hasContentTypeParser("image/png")) app.addContentTypeParser([...PROOF_TYPES], { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  const add = (route: StaffRoute): void => {
    if (!route.url.startsWith(STAFF_PATH_PREFIX)) throw new Error(`staff route outside ${STAFF_PATH_PREFIX}: ${route.url}`);
    if (route.adminOnly !== true && ADMIN_ONLY_PATHS.some((path) => path.test(route.url))) throw new Error(`admin-only staff route registered for every role: ${route.url}`);
    app.route({
      method: route.method,
      url: route.url,
      constraints: { host: gate.adminHost },
      ...(route.bodyLimit === undefined ? {} : { bodyLimit: route.bodyLimit }),
      ...(route.tooLargeKey === undefined ? {} : { errorHandler: tooLarge(route.tooLargeKey) }),
      onRequest: guard(gate, route, contexts),
      handler: async (request, reply) => {
        void reply.header("cache-control", "no-store");
        const context = contexts.get(request);
        if (context === undefined) throw unauthorized();
        return route.handler(request, reply, context);
      },
    });
  };
  for (const register of routes) register(add);
}
