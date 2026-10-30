import { eq } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { customers } from "../../../shared/database/schema";
import { hashPassword } from "../domain/password-hash";
import { newPassword } from "../domain/password-policy";
import { deleteSessionsForCustomer } from "../infrastructure/session.repository";

export interface IssuedPassword {
  customerId: string;
  password: string;
}

/**
 * Ports `accounts.py::issue_password`. The plaintext is returned here and
 * NOWHERE else: it is not written to the database, not logged, and cannot be
 * read back afterwards. Any old password stops working immediately.
 *
 * Sessions are kept by default, as the Python does (so a customer stays
 * signed in on their own devices); pass `revokeSessions` to end them too.
 * Failed attempts are cleared, so a locked-out customer can try again.
 */
export function issuePassword(
  db: Db,
  customerId: string,
  nowIso: string,
  options: { revokeSessions?: boolean } = {},
): IssuedPassword | null {
  const exists = db
    .select({ customerId: customers.customerId })
    .from(customers)
    .where(eq(customers.customerId, customerId))
    .get();
  if (!exists) return null;

  const password = newPassword();
  db.update(customers)
    .set({
      passwordHash: hashPassword(password),
      passwordSetAt: nowIso,
      failedLogins: 0,
      lockedUntil: null,
    })
    .where(eq(customers.customerId, customerId))
    .run();
  if (options.revokeSessions) deleteSessionsForCustomer(db, customerId);
  return { customerId, password };
}
