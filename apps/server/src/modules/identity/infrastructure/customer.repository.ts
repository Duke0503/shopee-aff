import { eq, inArray, or } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { customerAliases, customers } from "../../../shared/database/schema";

/** Strip every whitespace character, as the Python does before any lookup. */
export function normaliseKey(key: string): string {
  return (key ?? "").split(/\s+/).join("");
}

/**
 * The customer behind any identifier a person can type: a DP code (any case,
 * spaces ignored), an internal id, a Zalo UID, or an old id merged into
 * another row (customer_aliases) — including a retired DP code.
 *
 * Ports `ledger.find_customer_id()` exactly. Returns null when nothing
 * matches; it is NEVER guessed into a guest.
 */
export function findCustomerIdByAnyId(db: Db, rawKey: string): string | null {
  const key = normaliseKey(rawKey);
  if (!key) return null;

  const direct = db
    .select({ id: customers.customerId })
    .from(customers)
    .where(
      or(
        eq(customers.customerCode, key.toUpperCase()),
        eq(customers.customerId, key),
        eq(customers.zaloUserId, key),
      ),
    )
    .get();
  if (direct) return direct.id;

  const alias = db
    .select({ id: customerAliases.customerId })
    .from(customerAliases)
    .where(inArray(customerAliases.alias, [key, key.toUpperCase()]))
    .get();
  return alias ? alias.id : null;
}
