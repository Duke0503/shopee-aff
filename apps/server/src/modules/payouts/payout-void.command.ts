/**
 * Voiding a payout recorded by mistake (FR-34, AD-9, AD-7, AD-17, D24, D41, INV-2, INV-11; Story
 * 4.10). An admin-only command with a required reason that undoes exactly what the payout wrote,
 * in one `BEGIN IMMEDIATE` transaction. It applies the plan of payout-void.query.ts, the same plan
 * the void dialog showed:
 *
 *   - each covered order goes to the state `transition` gives from its latest report row
 *     (REVERSED if a cancel was seen, else APPROVED), paid_at cleared, with history and audit;
 *   - each bonus the payout paid returns to CONFIRMED, or to VOID when its order is now REVERSED
 *     or REJECTED;
 *   - the planned OFFSET entries (netting reversed, clawbacks on covered orders closed) and
 *     NETTING_REFUND credits (netting a later payout already took from such a clawback, and void
 *     credits this payout had paid), so the customer is neither asked for money they never got nor
 *     left short of money a clawback took;
 *   - the payout becomes VOIDED with the time, the reason and the admin, and the receipt shows it;
 *   - when the customer was told about the payout (an outbox row `payout:<id>:recorded` exists,
 *     enqueued or seeded as sent by the cutover), one correction message `payout:<id>:voided`.
 *
 * Voiding a VOIDED payout returns it again and writes nothing. Ledger entries stay insert-only;
 * the payout claim stays CONFIRMED (a claim never changes back), and the customer can be claimed
 * again for whatever is payable once more.
 */
import { parseInstant, type Clock, type Instant } from "@cashback/core";
import { and, eq } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { hasStaffRole, type CommandAudit } from "../../platform/ports/audit.port";
import type { OutboxLookup, OutboxPort } from "../../platform/ports/outbox.port";
import { orderAwardsFor, returnPaidAwards } from "../campaigns/index";
import { applyUnpaid, orderStatusOf } from "../orders/index";
import { planVoid, voidedKey, type PlannedEntry, type VoidPlan } from "./payout-void.query";
import { ledgerEntries, payoutItems, payouts, type RecordedPayoutRow } from "./schema";

export const PAYOUT_VOIDED_MESSAGE = "payout_voided";
export const VOID_REASON_MAX = 500;
const VOID_ENTRY_REASON = "payout_voided";

export type PayoutVoidErrorCode = "admin_only" | "reason_required" | "payout_not_found";

export class PayoutVoidError extends Error {
  constructor(readonly code: PayoutVoidErrorCode) {
    super(`payout void: ${code}`);
    this.name = "PayoutVoidError";
  }
}

export interface VoidDeps {
  readonly clock: Clock;
  readonly by: CommandAudit;
  readonly outbox: OutboxPort & OutboxLookup;
}

export interface VoidedOrder {
  readonly orderId: string;
  readonly to: string;
}

export interface VoidedPayout {
  readonly payoutId: number;
  readonly customerId: string;
  readonly amount: number;
  /** Null only for a voided row that never recorded its time. */
  readonly voidedAt: Instant | null;
  readonly orders: readonly VoidedOrder[];
  /** OFFSET and NETTING_REFUND entries written. */
  readonly offsets: number;
  readonly corrected: boolean;
  readonly replay: boolean;
}

const voidedAtOf = (row: RecordedPayoutRow): Instant | null => (row.voidedAt === null ? null : parseInstant(row.voidedAt));

function insert(db: LedgerDb, kind: "OFFSET" | "NETTING_REFUND", e: PlannedEntry, payoutId: number, deps: VoidDeps): void {
  db.insert(ledgerEntries)
    .values({ customerId: e.customerId, clawbackId: e.clawbackId, kind, amount: e.amount, orderId: e.orderId, payoutId, reason: VOID_ENTRY_REASON, createdAt: deps.clock.now(), createdBy: deps.by.actor.id })
    .run();
}

function replayOf(db: LedgerDb, row: RecordedPayoutRow, deps: VoidDeps): VoidedPayout {
  const items = db.select({ orderId: payoutItems.orderId }).from(payoutItems).where(and(eq(payoutItems.payoutId, row.payoutId), eq(payoutItems.kind, "ORDER"))).all();
  const written = db.select({ kind: ledgerEntries.kind }).from(ledgerEntries).where(eq(ledgerEntries.payoutId, row.payoutId)).all();
  const offsets = written.filter((e) => e.kind === "OFFSET" || e.kind === "NETTING_REFUND").length;
  const orders = items.map((i) => ({ orderId: i.orderId, to: orderStatusOf(db, i.orderId) ?? "" }));
  return { payoutId: row.payoutId, customerId: row.customerId, amount: row.transferAmount, voidedAt: voidedAtOf(row), orders, offsets, corrected: deps.outbox.told(voidedKey(row.payoutId)), replay: true };
}

function apply(db: LedgerDb, plan: VoidPlan, reason: string, deps: VoidDeps): VoidedPayout {
  const { payout } = plan;
  const awards = orderAwardsFor(db, deps.clock, deps.by);
  for (const o of plan.orders) applyUnpaid(db, o.state, `payout ${payout.payoutId} voided`, { ...deps, awards });
  returnPaidAwards(db, deps.clock, { confirmed: plan.awards.filter((a) => a.to === "CONFIRMED").map((a) => a.awardId), voided: plan.awards.filter((a) => a.to === "VOID").map((a) => a.awardId) }, deps.by);
  for (const e of plan.offsets) insert(db, "OFFSET", e, payout.payoutId, deps);
  for (const e of plan.refunds) insert(db, "NETTING_REFUND", e, payout.payoutId, deps);
  const updated = db.update(payouts).set({ status: "VOIDED", voidedAt: deps.clock.now(), voidReason: reason, voidedBy: deps.by.actor.id }).where(and(eq(payouts.payoutId, payout.payoutId), eq(payouts.status, "RECORDED"))).returning().get();
  if (updated === undefined) throw new PayoutVoidError("payout_not_found");
  const orders = plan.orders.map((o) => ({ orderId: o.orderId, to: o.state.to }));
  const offsets = plan.offsets.length + plan.refunds.length;
  const reversed = orders.filter((o) => o.to === "REVERSED").length;
  deps.by.audit.record({ actor: deps.by.actor, event: "payouts.payout.voided", entityId: String(payout.payoutId), payload: { payoutId: payout.payoutId, customerId: payout.customerId, amount: payout.transferAmount, orders: orders.length, reversed, offsets, refunds: plan.refunds.length, told: plan.told }, reason });
  if (plan.told) {
    deps.outbox.enqueue({ dedupKey: voidedKey(payout.payoutId), customerId: payout.customerId, messageKey: PAYOUT_VOIDED_MESSAGE, params: { payoutId: payout.payoutId, amount: payout.transferAmount }, transferAmount: payout.transferAmount });
  }
  return { payoutId: payout.payoutId, customerId: payout.customerId, amount: payout.transferAmount, voidedAt: voidedAtOf(updated), orders, offsets, corrected: plan.told, replay: false };
}

/** Voids a payout as an admin, with a reason; run inside `tx`. */
export function voidPayout(db: LedgerDb, input: { readonly payoutId: number; readonly reason: string }, deps: VoidDeps): VoidedPayout {
  if (!hasStaffRole(deps.by.actor, ["ADMIN"])) throw new PayoutVoidError("admin_only");
  const reason = input.reason.trim();
  if (reason.length === 0 || reason.length > VOID_REASON_MAX) throw new PayoutVoidError("reason_required");
  const plan = planVoid(db, input.payoutId, deps.outbox);
  if (plan !== null) return apply(db, plan, reason, deps);
  const row = db.select().from(payouts).where(eq(payouts.payoutId, input.payoutId)).get();
  if (row === undefined) throw new PayoutVoidError("payout_not_found");
  return replayOf(db, row, deps);
}
