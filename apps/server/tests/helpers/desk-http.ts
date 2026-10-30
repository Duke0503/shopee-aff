/**
 * Calling the admin desk's staff routes in a test: a staff session cookie for a seeded staff
 * member, and GET or POST on the admin host with the Access JWT and, for a POST, the admin
 * Origin, exactly as the edge and the browser would send them.
 */
import { errorEnvelopeSchema } from "@cashback/contracts";
import type { Clock } from "@cashback/core";

import { openSession, STAFF_SESSION_MS } from "../../src/modules/identity/index";
import type { Ledger } from "../../src/platform/db/ledger";
import { ACCESS_JWT_HEADER } from "../../src/platform/http/access-jwt.guard";
import type { Servers } from "../../src/platform/http/servers";
import { STAFF_SESSION_COOKIE } from "../../src/platform/http/session-cookie";
import { accessJwt, ADMIN_HOST, ORIGIN } from "./staff-desk";

export function staffCookie(ledger: Ledger, staffId: string, clock: Clock): string {
  return `${STAFF_SESSION_COOKIE}=${ledger.tx((db) => openSession(db, { kind: "STAFF", staffId }, clock, STAFF_SESSION_MS)).token}`;
}

export function deskGet(s: Servers, url: string, cookie: string, clock: Clock) {
  return s.publicApp.inject({ method: "GET", url, headers: { host: ADMIN_HOST, cookie, [ACCESS_JWT_HEADER]: accessJwt(clock) } });
}

export function deskPost(s: Servers, url: string, cookie: string, body: unknown, clock: Clock) {
  return s.publicApp.inject({ method: "POST", url, headers: { host: ADMIN_HOST, origin: ORIGIN, cookie, [ACCESS_JWT_HEADER]: accessJwt(clock) }, payload: body as object });
}

export const errorOf = (body: string) => errorEnvelopeSchema.parse(JSON.parse(body)).error;
