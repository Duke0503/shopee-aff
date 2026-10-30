import { eq } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { customers } from "../../../shared/database/schema";
import { hashPassword, verifyPassword } from "../domain/password-hash";
import { PASSWORD_LENGTH } from "../domain/password-policy";

export type ChangePasswordResult = "ok" | "unknown_customer" | "wrong_password" | "too_short";

/**
 * Ports `accounts.py::change_password`: a signed-in customer chooses their own
 * password. The current one must match, and the replacement is at least as long
 * as an issued one. Other sessions are left alone, exactly as the Python does.
 */
export function changePassword(
  db: Db,
  customerId: string,
  current: string,
  replacement: string,
  nowIso: string,
): ChangePasswordResult {
  const row = db
    .select({ passwordHash: customers.passwordHash })
    .from(customers)
    .where(eq(customers.customerId, customerId))
    .get();
  if (!row) return "unknown_customer";
  if (!verifyPassword(current, row.passwordHash)) return "wrong_password";
  if ((replacement ?? "").length < PASSWORD_LENGTH) return "too_short";

  db.update(customers)
    .set({ passwordHash: hashPassword(replacement), passwordSetAt: nowIso })
    .where(eq(customers.customerId, customerId))
    .run();
  return "ok";
}
