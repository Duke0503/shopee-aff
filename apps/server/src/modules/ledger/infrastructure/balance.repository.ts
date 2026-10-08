import { eq } from "drizzle-orm";

import { balanceFor, type Balance } from "@mmo/money";

import type { Db } from "../../../shared/database/connection";
import { orders } from "../../../shared/database/schema";

/**
 * A customer's balance, using the shared money maths. `rate` is the
 * cashback rate from config; the default matches production.
 */
export function computeBalanceFor(db: Db, customerId: string, rate = 0.8): Balance {
  const rows = db.select().from(orders).where(eq(orders.customerId, customerId)).all();

  return balanceFor({
    approvedUnpaidCashbackVnd: rows
      .filter((row) => row.status === "approved" && row.paidAt === null)
      .map((row) => row.cashbackAmount ?? 0),
    awaitingEstimatedCommissionVnd: rows
      .filter((row) => row.status === "awaiting_approval")
      .map((row) => row.estimatedCommission ?? 0),
    paidCashbackVnd: rows.filter((row) => row.status === "paid").map((row) => row.cashbackAmount ?? 0),
    confirmedBonusVnd: 0,
    awaitingBonusVnd: 0,
    paidBonusVnd: 0,
    cashbackRate: rate,
    isHouse: customerId === "HOUSE",
  });
}
