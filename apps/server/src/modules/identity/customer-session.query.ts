/**
 * Who holds a customer cookie (AD-18, INV-5, INV-8): the open CUSTOMER session of an ACTIVE
 * customer, unexpired (a trusted phone's session has no expiry, FR-9). A staff session resolves
 * to nobody here, whichever cookie it arrives in. Customer reads are scoped to the id this gives.
 * The website also needs to say why a cookie no longer opens anything when a new password from
 * /matkhau ended it (Story 7.2 AC5); every other reason reads as simply signed out.
 */
import type { Clock } from "@cashback/core";
import { and, eq, gt, isNull, or } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { customers, sessions } from "./schema";
import { sessionTokenHash } from "./session-token";

export function customerSessionOf(db: LedgerDb, token: string | null, clock: Clock): string | null {
  const tokenHash = sessionTokenHash(token);
  if (tokenHash === null) return null;
  const found = db
    .select({ customerId: customers.customerId })
    .from(sessions)
    .innerJoin(customers, eq(customers.customerId, sessions.customerId))
    .where(and(eq(sessions.tokenHash, tokenHash), eq(sessions.kind, "CUSTOMER"), isNull(sessions.endedAt), or(isNull(sessions.expiresAt), gt(sessions.expiresAt, clock.now())), eq(customers.status, "ACTIVE")))
    .get();
  return found?.customerId ?? null;
}

export type CustomerSessionState =
  | { readonly state: "signed_in"; readonly customerId: string; readonly customerCode: string }
  | { readonly state: "ended_by_new_password" }
  | { readonly state: "signed_out" };

/** The signed-in customer and their code, or why there is none. */
export function customerSessionStateOf(db: LedgerDb, token: string | null, clock: Clock): CustomerSessionState {
  const customerId = customerSessionOf(db, token, clock);
  if (customerId !== null) {
    const code = db.select({ customerCode: customers.customerCode }).from(customers).where(eq(customers.customerId, customerId)).get()?.customerCode ?? null;
    return code === null ? { state: "signed_out" } : { state: "signed_in", customerId, customerCode: code };
  }
  const tokenHash = sessionTokenHash(token);
  if (tokenHash === null) return { state: "signed_out" };
  const ended = db
    .select({ reason: sessions.endReason })
    .from(sessions)
    .where(and(eq(sessions.tokenHash, tokenHash), eq(sessions.kind, "CUSTOMER")))
    .get();
  return ended?.reason === "NEW_PASSWORD" ? { state: "ended_by_new_password" } : { state: "signed_out" };
}
