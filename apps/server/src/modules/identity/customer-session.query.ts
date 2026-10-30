/**
 * Who holds a customer cookie (AD-18, INV-5, INV-8): the open CUSTOMER session of an ACTIVE
 * customer, unexpired (a trusted phone's session has no expiry, FR-9). A staff session resolves
 * to nobody here, whichever cookie it arrives in. Customer reads are scoped to the id this gives.
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
