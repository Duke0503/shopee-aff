/**
 * Who a notification goes to (AD-15, AD-16, D5): the surviving customer's Zalo id as the
 * assistant's account sees it. A customer without a separate Zalo id whose customer id is itself a
 * Zalo uid (the live id form: digits only) is written to at that id, as the live system did
 * (notifications.py RECIPIENT). A guest (HOUSE), an erased customer, a key that resolves to no one
 * or a customer with neither has no recipient.
 */
import { eq } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { resolveCustomer } from "./customer.query";
import { customers } from "./schema";

/** A Zalo uid as the live system stored it in place of a separate Zalo id. */
export const LIVE_ZALO_UID = /^\d{15,25}$/;

export interface ZaloRecipient {
  readonly customerId: string;
  readonly zaloUserId: string;
}

export function zaloRecipientOf(db: LedgerDb, key: string): ZaloRecipient | null {
  const customer = resolveCustomer(db, key);
  if (customer === null || customer.role === "HOUSE") return null;
  const zaloUserId = db.select({ zalo: customers.zaloUserId }).from(customers).where(eq(customers.customerId, customer.customerId)).get()?.zalo?.trim() ?? "";
  if (zaloUserId !== "") return { customerId: customer.customerId, zaloUserId };
  return LIVE_ZALO_UID.test(customer.customerId) ? { customerId: customer.customerId, zaloUserId: customer.customerId } : null;
}
