import { and, eq, isNull, sql } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { customers, orders } from "../../../shared/database/schema";
import { confirmedBonusesByCustomer } from "../../orders";
import { collectPayables, type Payables } from "../domain/payables";

/**
 * Read every customer's payable right now: their approved, unpaid orders
 * summed per customer, PLUS the campaign bonuses that are CONFIRMED (an order
 * that is approved pays its bonus with it), with the bank-account check.
 */
export function collectPayablesFromDb(db: Db, nowIso: string): Payables {
  const grouped = db
    .select({
      customerId: orders.customerId,
      cashback: sql<number>`COALESCE(SUM(${orders.cashbackAmount}), 0)`,
    })
    .from(orders)
    .where(and(eq(orders.status, "approved"), isNull(orders.paidAt)))
    .groupBy(orders.customerId)
    .all();

  const bonuses = confirmedBonusesByCustomer(db);
  const inputs = grouped
    .filter((row): row is { customerId: string; cashback: number } => row.customerId !== null)
    .map((row) => {
      const customer = db
        .select({ bankAccount: customers.bankAccount })
        .from(customers)
        .where(eq(customers.customerId, row.customerId))
        .get();
      return {
        customerId: row.customerId,
        approvedUnpaidCashbackVnd: Number(row.cashback),
        confirmedBonusVnd: bonuses.get(row.customerId) ?? 0,
        hasBankAccount: Boolean(customer?.bankAccount),
        bankChangedAtIso: null,
      };
    });

  return collectPayables(inputs, nowIso);
}
