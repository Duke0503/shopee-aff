/**
 * Opening and ending sessions (AD-18, INV-8). A session row holds the SHA-256 of its token and
 * exactly one owner, a customer or a staff member, as its kind says; the token itself is returned
 * once, for the cookie, and never stored. Call inside `tx`.
 */
import { toMs, instantFromMs, type Clock, type Instant } from "@cashback/core";
import { and, eq, isNull } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { sessions, type SessionEndReason } from "./schema";
import { newSessionToken, sessionTokenHash } from "./session-token";

/** A staff session lasts one working day from sign-in; Cloudflare Access has its own expiry too. */
export const STAFF_SESSION_MS = 12 * 3_600_000;

export type SessionOwner = { readonly kind: "STAFF"; readonly staffId: string } | { readonly kind: "CUSTOMER"; readonly customerId: string };

export interface OpenedSession {
  /** For the cookie only; never stored or logged. */
  readonly token: string;
  readonly expiresAt: Instant | null;
}

/** Opens a session; `lifetimeMs` null means valid until ended (a customer's trusted phone, FR-9). */
export function openSession(db: LedgerDb, owner: SessionOwner, clock: Clock, lifetimeMs: number | null): OpenedSession {
  const { token, tokenHash } = newSessionToken();
  const now = clock.now();
  const expiresAt = lifetimeMs === null ? null : instantFromMs(toMs(now) + lifetimeMs);
  db.insert(sessions)
    .values({
      tokenHash,
      kind: owner.kind,
      customerId: owner.kind === "CUSTOMER" ? owner.customerId : null,
      staffId: owner.kind === "STAFF" ? owner.staffId : null,
      createdAt: now,
      expiresAt,
    })
    .run();
  return { token, expiresAt };
}

/** Ends the session the token opens, if it is still open; true when one was ended. */
export function endSession(db: LedgerDb, token: string | null, reason: SessionEndReason, clock: Clock): boolean {
  const tokenHash = sessionTokenHash(token);
  if (tokenHash === null) return false;
  const ended = db
    .update(sessions)
    .set({ endedAt: clock.now(), endReason: reason })
    .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.endedAt)))
    .run();
  return ended.changes > 0;
}
