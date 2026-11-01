/**
 * A new website password from `/matkhau` (AD-18, FR-9, D21, INV-8; Story 6.8). The password is 8
 * characters drawn with `crypto.randomInt` from letters and digits that cannot be misread
 * (no 0/O, 1/l/I); it is returned once, for the reply in the private chat, and only its argon2id
 * hash is stored. Issuing it ends every open session of the customer (from the chat there is no
 * session of their own to keep) and clears the sign-in failures, so the new password works at
 * once. The hash is made by the caller before the transaction (password-hash.ts); `setCustomerPassword`
 * is called inside `tx` and writes one audit entry that names no password.
 */
import { randomInt } from "node:crypto";
import type { Clock } from "@cashback/core";
import { and, eq, isNull } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import type { CommandAudit } from "../../platform/ports/audit.port";
import { customers, sessions } from "./schema";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
export const ISSUED_PASSWORD_CHARS = 8;

export function newCustomerPassword(pick: (max: number) => number = randomInt): string {
  let password = "";
  for (let i = 0; i < ISSUED_PASSWORD_CHARS; i++) password += ALPHABET[pick(ALPHABET.length)];
  return password;
}

/** Null, and nothing written, when the record is no longer an active customer (USER). */
export function setCustomerPassword(db: LedgerDb, customerId: string, hash: string, deps: { readonly clock: Clock; readonly by: CommandAudit }): { readonly sessionsEnded: number } | null {
  const now = deps.clock.now();
  const updated = db
    .update(customers)
    .set({ passwordHash: hash, passwordSetAt: now, failedSignIns: 0, lockedUntil: null })
    .where(and(eq(customers.customerId, customerId), eq(customers.role, "USER"), eq(customers.status, "ACTIVE")))
    .run();
  if (updated.changes !== 1) return null;
  const sessionsEnded = db
    .update(sessions)
    .set({ endedAt: now, endReason: "NEW_PASSWORD" })
    .where(and(eq(sessions.customerId, customerId), eq(sessions.kind, "CUSTOMER"), isNull(sessions.endedAt)))
    .run().changes;
  deps.by.audit.record({ actor: deps.by.actor, event: "identity.customer.password_issued", entityId: customerId, payload: { customerId, sessionsEnded } });
  return { sessionsEnded };
}
