import { eq } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { sessions } from "../../../shared/database/schema";
import { hashSessionToken } from "../domain/password-hash";

/**
 * The `sessions` table. Only the SHA-256 of the token is stored, never the
 * token itself. Expiry is compared as ISO strings, as the Python does.
 */
export function createSession(
  db: Db,
  customerId: string,
  token: string,
  nowIso: string,
  expiresAtIso: string,
): void {
  db.insert(sessions)
    .values({ tokenHash: hashSessionToken(token), customerId, createdAt: nowIso, expiresAt: expiresAtIso })
    .run();
}

/** The customer behind a token, or null when unknown or expired. */
export function findSessionCustomer(db: Db, token: string, nowIso: string): string | null {
  if (!token) return null;
  const row = db
    .select({ customerId: sessions.customerId, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(eq(sessions.tokenHash, hashSessionToken(token)))
    .get();
  if (!row) return null;
  return row.expiresAt > nowIso ? row.customerId : null;
}

export function deleteSession(db: Db, token: string): void {
  db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token))).run();
}

/** Sign out everywhere (after a password or bank change). */
export function deleteSessionsForCustomer(db: Db, customerId: string): void {
  db.delete(sessions).where(eq(sessions.customerId, customerId)).run();
}
