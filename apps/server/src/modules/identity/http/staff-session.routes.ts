/**
 * The admin desk's sign-in routes (AD-18, Story 4.2), in the staff route group. Sign-in and
 * sign-out need the Access JWT and the Origin but no session: sign-out ends the session the cookie
 * names, if it is still open, and clears the cookie in every case, so an expired session can
 * still sign out. Who-am-I needs the staff session. A refused sign-in says nothing about which
 * part was wrong; a name still waiting out its delay gets 429.
 */
import { staffSessionResponseSchema, staffSignInRequestSchema, type StaffSessionResponse } from "@cashback/contracts";
import { toMs, type Clock } from "@cashback/core";

import type { Ledger, LedgerDb } from "../../../platform/db/ledger";
import { HttpError } from "../../../platform/http/error-envelope";
import { clearedCookie, readCookie, sessionCookie, STAFF_SESSION_COOKIE } from "../../../platform/http/session-cookie";
import type { StaffRoutes } from "../../../platform/http/staff-routes";
import type { AuditPort } from "../../../platform/ports/audit.port";
import { endSession } from "../session.command";
import { signInStaff } from "../staff-sign-in.command";

export interface StaffSessionRouteDeps {
  readonly ledger: Ledger;
  readonly clock: Clock;
  readonly auditFor: (db: LedgerDb) => AuditPort;
}

export function staffSessionRoutes(deps: StaffSessionRouteDeps): StaffRoutes {
  return (add) => {
    add({
      method: "POST",
      url: "/api/admin/session",
      session: false,
      handler: async (request, reply, { access }): Promise<StaffSessionResponse> => {
        const body = staffSignInRequestSchema.safeParse(request.body);
        if (!body.success) throw new HttpError("invalid_request", "error.invalid_request");
        const result = await signInStaff(deps.ledger, { ...body.data, accessSubject: access.subject }, { clock: deps.clock, auditFor: deps.auditFor });
        if (result.outcome === "refused") {
          if (result.reason === "waiting") throw new HttpError("rate_limited", "error.staff_sign_in_waiting", result.retryAt === undefined ? undefined : { retryAt: result.retryAt });
          throw new HttpError("unauthorized", "error.staff_sign_in_refused");
        }
        const { session } = result;
        const maxAge = session.expiresAt === null ? null : Math.floor((toMs(session.expiresAt) - toMs(deps.clock.now())) / 1000);
        void reply.header("set-cookie", sessionCookie(STAFF_SESSION_COOKIE, session.token, maxAge));
        return staffSessionResponseSchema.parse({ ...result.staff, ...(session.expiresAt === null ? {} : { expiresAt: session.expiresAt }) });
      },
    });
    add({
      method: "GET",
      url: "/api/admin/session",
      handler: async (_request, _reply, { staff }): Promise<StaffSessionResponse> => staffSessionResponseSchema.parse(staff),
    });
    add({
      method: "DELETE",
      url: "/api/admin/session",
      session: false,
      handler: async (request, reply) => {
        const token = readCookie(request.headers.cookie, STAFF_SESSION_COOKIE);
        deps.ledger.tx((db) => endSession(db, token, "SIGNED_OUT", deps.clock));
        void reply.header("set-cookie", clearedCookie(STAFF_SESSION_COOKIE));
        return { signedOut: true };
      },
    });
  };
}
