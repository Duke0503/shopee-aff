/**
 * The customer website's sign-in routes on the public listener (AD-18, FR-9, Story 7.2).
 * `POST /api/session` and `DELETE /api/session` change something, so both need the website's own
 * Origin (a refusal asks to reload the page). A refused sign-in says nothing about which part was
 * wrong; a code or a client waiting out its delay gets 429 with the time it may try again. The
 * throttles are keyed by an HMAC of the caller's address, given by `clientKey`. The cookie lasts as long as browsers allow (400 days):
 * the session itself has no expiry and ends only at sign-out or with a new password. `GET` says
 * who is signed in; a cookie a new password ended gets its own message once, and the cookie is
 * cleared so the next page simply shows the sign-in form. No answer is ever cached.
 */
import { CUSTOMER_CODE_INPUT, CUSTOMER_SESSION_PATH, customerSessionResponseSchema, customerSignInRequestSchema, type CustomerSessionResponse } from "@cashback/contracts";
import type { Clock } from "@cashback/core";
import type { FastifyInstance, FastifyRequest } from "fastify";

import type { Ledger, LedgerDb } from "../../../platform/db/ledger";
import { HttpError } from "../../../platform/http/error-envelope";
import { requireOrigin } from "../../../platform/http/origin.guard";
import type { PublicRoutes } from "../../../platform/http/servers";
import { clearedCookie, CUSTOMER_SESSION_COOKIE, readCookie, sessionCookie } from "../../../platform/http/session-cookie";
import type { AlertPort } from "../../../platform/ports/alert.port";
import type { AuditPort } from "../../../platform/ports/audit.port";
import type { SignInBurstWatch } from "../domain/sign-in-burst";
import type { UnknownSignInTally } from "../sign-in-tally";
import { customerSessionStateOf } from "../customer-session.query";
import { signInCustomer } from "../customer-sign-in.command";
import { endSession } from "../session.command";

/** Browsers keep a cookie at most 400 days; a signed-in phone stays signed in that long. */
export const CUSTOMER_COOKIE_MAX_AGE_S = 400 * 86_400;

export interface CustomerSessionRouteDeps {
  readonly ledger: Ledger;
  readonly clock: Clock;
  readonly auditFor: (db: LedgerDb) => AuditPort;
  readonly alertsFor: (db: LedgerDb) => AlertPort;
  readonly burst: SignInBurstWatch;
  readonly unknown: UnknownSignInTally;
  /** The HMAC of the caller's address (platform/http/client-key.ts). */
  readonly clientKey: (request: FastifyRequest) => string;
  /** The website's own origins (AD-18 Origin check). */
  readonly origins: readonly string[];
  readonly verify?: (hash: string, password: string) => Promise<boolean>;
}

function signInRoute(app: FastifyInstance, deps: CustomerSessionRouteDeps): void {
  app.post(CUSTOMER_SESSION_PATH, async (request, reply): Promise<CustomerSessionResponse> => {
    void reply.header("cache-control", "no-store");
    requireOrigin(request, deps.origins);
    const body = customerSignInRequestSchema.safeParse(request.body);
    if (!body.success) throw new HttpError("invalid_request", "error.invalid_request");
    if (!CUSTOMER_CODE_INPUT.test(body.data.customerCode)) throw new HttpError("invalid_request", "error.customer_code_format", { customerCode: "error.customer_code_format" });
    if (body.data.password === "") throw new HttpError("invalid_request", "error.password_required", { password: "error.password_required" });
    const { auditFor, alertsFor, burst, unknown, clock } = deps;
    const input = { ...body.data, clientKey: deps.clientKey(request) };
    const result = await signInCustomer(deps.ledger, input, { clock, auditFor, alertsFor, burst, unknown, ...(deps.verify ? { verify: deps.verify } : {}) });
    if (result.outcome === "refused") {
      if (result.reason === "waiting") throw new HttpError("rate_limited", "error.customer_sign_in_waiting", result.retryAt === undefined ? undefined : { retryAt: result.retryAt });
      throw new HttpError("unauthorized", "error.customer_sign_in_refused");
    }
    void reply.header("set-cookie", sessionCookie(CUSTOMER_SESSION_COOKIE, result.session.token, CUSTOMER_COOKIE_MAX_AGE_S));
    return customerSessionResponseSchema.parse({ customerCode: result.customerCode });
  });
}

export function customerSessionRoutes(deps: CustomerSessionRouteDeps): PublicRoutes {
  return (app) => {
    signInRoute(app, deps);
    app.get(CUSTOMER_SESSION_PATH, async (request, reply): Promise<CustomerSessionResponse> => {
      void reply.header("cache-control", "no-store");
      const token = readCookie(request.headers.cookie, CUSTOMER_SESSION_COOKIE);
      const found = customerSessionStateOf(deps.ledger.db, token, deps.clock);
      if (found.state === "signed_in") return customerSessionResponseSchema.parse({ customerCode: found.customerCode });
      if (token !== null) void reply.header("set-cookie", clearedCookie(CUSTOMER_SESSION_COOKIE));
      throw new HttpError("unauthorized", found.state === "ended_by_new_password" ? "error.session_ended_new_password" : "error.unauthorized");
    });
    app.delete(CUSTOMER_SESSION_PATH, async (request, reply) => {
      void reply.header("cache-control", "no-store");
      requireOrigin(request, deps.origins);
      const token = readCookie(request.headers.cookie, CUSTOMER_SESSION_COOKIE);
      deps.ledger.tx((db) => endSession(db, token, "SIGNED_OUT", deps.clock));
      void reply.header("set-cookie", clearedCookie(CUSTOMER_SESSION_COOKIE));
      return { signedOut: true };
    });
  };
}
