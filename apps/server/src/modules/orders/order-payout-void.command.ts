/**
 * The orders side of a payout void (AD-7, D4, D41, FR-34; Story 4.10). Voiding is the only way a
 * PAID order changes state, and it does so only through `transition`: the order returns to the
 * state its latest report row gives (REVERSED if a cancel was seen, else APPROVED) with paid_at
 * cleared, inside the payouts module's void transaction. An imported order whose live platform
 * mapped to no network has never been seen in a report, so it has no latest row and returns to
 * APPROVED; the void step reads no network rule, so no network is needed for it.
 *
 * The payouts module plans the void first (`unpaidStateOf`, no write) and then applies exactly that
 * plan (`applyUnpaid`), so the dialog's preview and the void cannot disagree.
 *
 * The transition's other effects are the caller's to carry out where they belong: `close_clawback`
 * is the payouts module's (it owns the ledger entries), and the awards are moved by id, because
 * only the bonuses this payout paid go back. A REVERSED order still voids its other live awards
 * here, as every reversal does. The customer is told once per payout by the void itself, so the
 * steps write history and audit but no message of their own.
 */
import type { Clock, OrderStatus } from "@cashback/core";
import { eq } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import type { CommandAudit } from "../../platform/ports/audit.port";
import type { OutboxPort } from "../../platform/ports/outbox.port";
import { splitWithheld } from "./domain/settlement";
import { transition, type TransitionContext, type TransitionResult } from "./domain/transition";
import type { OrderAwardsPort } from "./order-effects.port";
import { findOrder, latestObservation, transitionOrderOf, type StoredOrder } from "./order-ledger.repository";
import { OrderPayoutError } from "./order-payout.command";
import { recordSteps } from "./order-steps.command";
import { storedRow } from "./review-plan.query";
import { orders } from "./schema";

export interface UnpaidState {
  readonly orderId: string;
  readonly customerId: string | null;
  readonly from: OrderStatus;
  /** APPROVED, or REVERSED when the latest report row is a cancel. */
  readonly to: OrderStatus;
  readonly closesClawback: boolean;
  readonly result: TransitionResult;
}

/** The void step (`onPayout` in transition.ts) reads no network rule and no split; this only fills the context. */
const NO_NETWORK_CONTEXT: TransitionContext = { network: "shopee", withheld: true };

function planOf(db: LedgerDb, stored: StoredOrder): UnpaidState {
  const latest = stored.network === null ? null : latestObservation(db, stored.orderId);
  const row = latest === null || stored.network === null ? null : storedRow(latest.observation, stored.network);
  const context = stored.network === null ? NO_NETWORK_CONTEXT : { network: stored.network, withheld: splitWithheld(stored, () => true) };
  const result = transition(transitionOrderOf(db, stored), { kind: "payout_voided", latest: row }, context);
  if (result.next === null || !result.effects.some((e) => e.kind === "clear_paid_at")) throw new OrderPayoutError("not_paid_by_transition", `transition did not unpay order ${stored.orderId}`);
  return { orderId: stored.orderId, customerId: stored.customerId, from: stored.status, to: result.next, closesClawback: result.effects.some((e) => e.kind === "close_clawback"), result };
}

/** The state a void would give the order, without writing; throws for an order that is not PAID. */
export function unpaidStateOf(db: LedgerDb, orderId: string): UnpaidState {
  const stored = findOrder(db, orderId);
  if (stored === null) throw new OrderPayoutError("order_not_found", `no order ${orderId}`);
  return planOf(db, stored);
}

export interface OrderUnpaidDeps {
  readonly clock: Clock;
  readonly by: CommandAudit;
  readonly outbox: OutboxPort;
  readonly awards: OrderAwardsPort;
}

/** Carries out a planned void step on one PAID order; refuses when the order moved since the plan. Call inside the void's `tx`. */
export function applyUnpaid(db: LedgerDb, plan: UnpaidState, reason: string, deps: OrderUnpaidDeps): void {
  const orderId = plan.orderId;
  const stored = findOrder(db, orderId);
  if (stored === null || stored.status !== plan.from || planOf(db, stored).to !== plan.to) throw new OrderPayoutError("not_paid_by_transition", `order ${orderId} changed since the void was planned`);
  const now = deps.clock.now();
  db.update(orders).set({ status: plan.to, paidAt: null, updatedAt: now }).where(eq(orders.orderId, orderId)).run();
  if (plan.result.effects.some((e) => e.kind === "awards" && e.to === "VOID")) deps.awards.move(orderId, "VOID");
  const guest = transitionOrderOf(db, stored).guest;
  recordSteps(db, { orderId, customerId: stored.customerId, guest, steps: plan.result.steps, reason, facts: { cashback: stored.cashback ?? 0 }, params: {}, silentEvents: ["payout_voided", "reversed"] }, deps);
}

/** An order's current status, for the void to judge the bonuses it paid on orders it did not cover. */
export function orderStatusOf(db: LedgerDb, orderId: string): OrderStatus | null {
  return db.select({ status: orders.status }).from(orders).where(eq(orders.orderId, orderId)).get()?.status ?? null;
}
