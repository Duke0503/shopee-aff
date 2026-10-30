import { eq } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { customers } from "../../../shared/database/schema";
import { findCustomerIdByAnyId } from "../infrastructure/customer.repository";

/**
 * The assistant creates the customer the moment it first meets them on Zalo.
 * Ports the "find or create" step of `register-from-zalo`.
 *
 * The internal id IS the Zalo UID, because that is what goes into every
 * link's sub_id and can never change. A person who is already known (by UID
 * or by an alias) is returned as-is — an alias can NEVER become a new row.
 */
export interface ZaloIdentity {
  zaloUserId: string;
  displayName: string | null;
  privateChatId: string;
  nowIso: string;
}

export interface RegisterResult {
  customerId: string;
  created: boolean;
}

export function registerFromZalo(db: Db, input: ZaloIdentity): RegisterResult {
  const existing = findCustomerIdByAnyId(db, input.zaloUserId);
  if (existing) return { customerId: existing, created: false };

  db.insert(customers)
    .values({
      customerId: input.zaloUserId,
      zaloUserId: input.zaloUserId,
      displayName: input.displayName,
      privateChatId: input.privateChatId,
      role: "user",
      status: "active",
      createdAt: input.nowIso,
    })
    .run();
  return { customerId: input.zaloUserId, created: true };
}

/** True when this customer already has a private chat (the bot can message them). */
export function hasPrivateChat(db: Db, customerId: string): boolean {
  const row = db
    .select({ privateChatId: customers.privateChatId })
    .from(customers)
    .where(eq(customers.customerId, customerId))
    .get();
  return Boolean(row?.privateChatId);
}
