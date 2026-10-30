/**
 * The plan of a payout void (D41, M-3; Story 4.10): everything the void will write, worked out once
 * from the server's state and written by nothing here. The void dialog shows this plan as its
 * preview and the void command applies exactly this plan in its transaction, so the two can never
 * disagree:
 *
 *   - each covered order with its cashback and the state `transition` gives it (orders module);
 *   - each bonus the payout paid, and its next state (VOID when its order is REVERSED or REJECTED);
 *   - an OFFSET entry reversing each NETTING entry the payout wrote;
 *   - for a covered order whose transition closes its clawbacks: an OFFSET entry of what each still
 *     owes, and, when a later payout's netting had already taken part of it back, a NETTING_REFUND
 *     credit of that part, so the customer is paid it again;
 *   - a NETTING_REFUND entry restoring each void credit this payout paid (its REFUND_PAID entries);
 *   - whether the customer was told about the payout (then one correction message goes out).
 *
 * A voided payout has no plan; its preview shows its void facts and each order's current state.
 */
import type { OrderStatus } from "@cashback/core";
import { clawbackOpenAmount, sumDong } from "@cashback/money";
import { and, asc, eq, inArray } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import { dedupKey, type OutboxLookup } from "../../platform/ports/outbox.port";
import { customerCodeOf } from "../identity/index";
import { orderStatusOf, unpaidStateOf, type UnpaidState } from "../orders/index";
import { CLAWBACK_KINDS, ledgerEntries, payoutItems, payouts, type RecordedPayoutRow } from "./schema";

export const recordedKey = (payoutId: number): string => dedupKey("payout", String(payoutId), "recorded");
export const voidedKey = (payoutId: number): string => dedupKey("payout", String(payoutId), "voided");

export interface PlannedEntry {
  readonly customerId: string;
  readonly clawbackId: string;
  readonly orderId: string | null;
  readonly amount: number;
}

export interface VoidPlan {
  readonly payout: RecordedPayoutRow;
  readonly orders: readonly { readonly orderId: string; readonly cashback: number; readonly state: UnpaidState }[];
  readonly awards: readonly { readonly awardId: number; readonly orderId: string; readonly amount: number; readonly to: "CONFIRMED" | "VOID" }[];
  /** OFFSET entries: netting reversed (negative) and clawbacks closed (positive). */
  readonly offsets: readonly PlannedEntry[];
  /** NETTING_REFUND entries: credits for netting already taken, and credits this payout had paid. */
  readonly refunds: readonly PlannedEntry[];
  readonly told: boolean;
}

export interface VoidPreview {
  readonly payoutId: number;
  readonly customerId: string;
  readonly customerCode: string | null;
  readonly amount: number;
  readonly status: "RECORDED" | "VOIDED";
  readonly recordedAt: string | null;
  readonly voidedAt: string | null;
  readonly orders: readonly { readonly orderId: string; readonly cashback: number; readonly to: OrderStatus }[];
  readonly awards: VoidPlan["awards"];
  readonly nettingReversed: number;
  readonly clawbacksClosed: number;
  readonly refunded: number;
  readonly told: boolean;
}

type Entry = typeof ledgerEntries.$inferSelect;
const entryOf = (e: Pick<Entry, "customerId" | "clawbackId" | "orderId">, amount: number): PlannedEntry => ({ customerId: e.customerId, clawbackId: e.clawbackId, orderId: e.orderId, amount });

/** What closing the clawbacks on one order writes: an OFFSET of each open amount, and a credit of what netting already took. */
function closingsOf(db: LedgerDb, orderId: string): { offsets: PlannedEntry[]; refunds: PlannedEntry[] } {
  const entries = db
    .select()
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.orderId, orderId), inArray(ledgerEntries.kind, [...CLAWBACK_KINDS])))
    .orderBy(asc(ledgerEntries.entryId))
    .all();
  const offsets: PlannedEntry[] = [];
  const refunds: PlannedEntry[] = [];
  for (const clawbackId of new Set(entries.map((e) => e.clawbackId))) {
    const own = entries.filter((e) => e.clawbackId === clawbackId);
    const original = own.find((e) => e.kind === "CLAWBACK");
    if (original === undefined) continue;
    const open = clawbackOpenAmount(own.map((e) => e.amount));
    if (open < 0) offsets.push(entryOf(original, -open));
    // What the customer actually repaid: netting minus any netting a void already reversed.
    const repaid = sumDong(own.filter((e) => e.kind === "NETTING" || e.kind === "OFFSET").map((e) => e.amount), "repaid");
    if (repaid > 0) refunds.push(entryOf(original, repaid));
  }
  return { offsets, refunds };
}

function payoutEntries(db: LedgerDb, payoutId: number, kind: Entry["kind"]): Entry[] {
  return db
    .select()
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.payoutId, payoutId), eq(ledgerEntries.kind, kind)))
    .orderBy(asc(ledgerEntries.entryId))
    .all();
}

/** The plan of voiding a RECORDED payout; null for a payout that does not exist or is already voided. */
export function planVoid(db: LedgerDb, payoutId: number, outbox: OutboxLookup): VoidPlan | null {
  const payout = db.select().from(payouts).where(eq(payouts.payoutId, payoutId)).get();
  if (payout === undefined || payout.status !== "RECORDED") return null;
  const items = db.select().from(payoutItems).where(eq(payoutItems.payoutId, payoutId)).orderBy(asc(payoutItems.lineNo)).all();
  const orders = items.filter((i) => i.kind === "ORDER").map((i) => ({ orderId: i.orderId, cashback: i.amount, state: unpaidStateOf(db, i.orderId) }));
  const next = new Map(orders.map((o) => [o.orderId, o.state.to]));
  const awards = items.flatMap((i) => {
    if (i.kind !== "AWARD" || i.awardId === null) return [];
    const status = next.get(i.orderId) ?? orderStatusOf(db, i.orderId);
    return [{ awardId: i.awardId, orderId: i.orderId, amount: i.amount, to: status === "REVERSED" || status === "REJECTED" ? ("VOID" as const) : ("CONFIRMED" as const) }];
  });
  const offsets: PlannedEntry[] = payoutEntries(db, payoutId, "NETTING").map((e) => entryOf(e, -e.amount));
  const refunds: PlannedEntry[] = payoutEntries(db, payoutId, "REFUND_PAID").map((e) => entryOf(e, -e.amount));
  for (const o of orders) {
    if (!o.state.closesClawback) continue;
    const closing = closingsOf(db, o.orderId);
    offsets.push(...closing.offsets);
    refunds.push(...closing.refunds);
  }
  return { payout, orders, awards, offsets, refunds, told: outbox.told(recordedKey(payoutId)) };
}

const total = (entries: readonly PlannedEntry[], label: string): number => sumDong(entries.map((e) => e.amount), label);

/** The void dialog's preview: the plan as figures, or a voided payout's facts; null for no such payout. */
export function voidPreview(db: LedgerDb, payoutId: number, outbox: OutboxLookup): VoidPreview | null {
  const plan = planVoid(db, payoutId, outbox);
  const row = plan?.payout ?? db.select().from(payouts).where(eq(payouts.payoutId, payoutId)).get();
  if (row === undefined) return null;
  const facts = { payoutId, customerId: row.customerId, customerCode: customerCodeOf(db, row.customerId), amount: row.transferAmount, status: row.status, recordedAt: row.recordedAt, voidedAt: row.voidedAt };
  if (plan === null) {
    const items = db.select().from(payoutItems).where(and(eq(payoutItems.payoutId, payoutId), eq(payoutItems.kind, "ORDER"))).orderBy(asc(payoutItems.lineNo)).all();
    const orders = items.map((i) => ({ orderId: i.orderId, cashback: i.amount, to: orderStatusOf(db, i.orderId) ?? ("PAID" as const) }));
    return { ...facts, orders, awards: [], nettingReversed: 0, clawbacksClosed: 0, refunded: 0, told: outbox.told(recordedKey(payoutId)) };
  }
  return {
    ...facts,
    orders: plan.orders.map((o) => ({ orderId: o.orderId, cashback: o.cashback, to: o.state.to })),
    awards: plan.awards,
    nettingReversed: total(plan.offsets.filter((e) => e.amount < 0).map((e) => ({ ...e, amount: -e.amount })), "netting reversed"),
    clawbacksClosed: total(plan.offsets.filter((e) => e.amount > 0), "clawbacks closed"),
    refunded: total(plan.refunds, "refunded"),
    told: plan.told,
  };
}
