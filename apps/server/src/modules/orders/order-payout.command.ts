/**
 * The orders side of a payout confirm (AD-7, AD-9, R2, D4): the payouts module's confirm calls
 * this for each covered order, inside its own `BEGIN IMMEDIATE` transaction, so the order is
 * re-read under the write lock and moved to PAID only through `transition`. A report row applied
 * in another transaction therefore lands wholly before (a cancel reverses the order and this
 * confirm is refused) or wholly after (the order is PAID and the cancel becomes a clawback). The
 * customer message for the payout is the confirm's own (Story 4.8), so the PAID step tells nothing.
 */
import type { Clock } from "@cashback/core";
import { eq } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import type { CommandAudit } from "../../platform/ports/audit.port";
import type { OutboxPort } from "../../platform/ports/outbox.port";
import { splitWithheld } from "./domain/settlement";
import { transition, type Step } from "./domain/transition";
import type { OrderAwardsPort } from "./order-effects.port";
import { findOrder, transitionOrderOf } from "./order-ledger.repository";
import { recordSteps } from "./order-steps.command";
import { orders } from "./schema";

export type OrderPayoutErrorCode = "order_not_found" | "not_owner" | "not_paid_by_transition";

export class OrderPayoutError extends Error {
  constructor(
    readonly code: OrderPayoutErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OrderPayoutError";
  }
}

export interface OrderPaidDeps {
  readonly clock: Clock;
  readonly by: CommandAudit;
  readonly outbox: OutboxPort;
  readonly awards: OrderAwardsPort;
}

/** Marks one APPROVED order of `customerId` PAID; throws (rolling the confirm back) for any other order (R2). */
export function markOrderPaid(db: LedgerDb, input: { orderId: string; customerId: string }, deps: OrderPaidDeps): readonly Step[] {
  const stored = findOrder(db, input.orderId);
  if (stored === null || stored.network === null) throw new OrderPayoutError("order_not_found", `no payable order ${input.orderId}`);
  if (stored.customerId !== input.customerId) throw new OrderPayoutError("not_owner", `order ${input.orderId} is not the customer's`);
  const order = transitionOrderOf(db, stored);
  const result = transition(order, { kind: "payout_confirmed" }, { network: stored.network, withheld: splitWithheld(stored, () => true) });
  if (result.next !== "PAID" || !result.effects.some((e) => e.kind === "set_paid_at")) {
    throw new OrderPayoutError("not_paid_by_transition", `transition did not pay order ${input.orderId}`);
  }
  const now = deps.clock.now();
  db.update(orders).set({ status: result.next, paidAt: now, updatedAt: now }).where(eq(orders.orderId, input.orderId)).run();
  for (const e of result.effects) if (e.kind === "awards") deps.awards.move(input.orderId, e.to);
  recordSteps(db, { orderId: input.orderId, customerId: stored.customerId, guest: order.guest, steps: result.steps, reason: "payout confirmed", facts: { cashback: stored.cashback ?? 0 }, params: {}, silentEvents: ["paid"] }, deps);
  return result.steps;
}
