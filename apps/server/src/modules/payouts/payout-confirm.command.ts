/**
 * Confirming a payout (AD-9, AD-6, AD-16, AD-17, D4, D19, D32, D39, D42, INV-2, INV-3, INV-4;
 * Stories 4.8 and 4.11). The operator transfers first and confirms after, so confirm takes only
 * the claim id and the snapshot hash the panel showed, and in one `BEGIN IMMEDIATE` transaction:
 *
 *   - a CONFIRMED claim returns its payout again and writes nothing (a retry or a double click);
 *   - an OPEN claim is accepted, and so is an ABANDONED one while no other claim of the customer is
 *     OPEN, because the transfer may already have left the bank (D39);
 *   - the snapshot is read again under the write lock and its hash compared with the claim's and
 *     the panel's: on any difference (an order reversed, a new order, a bank account or hold
 *     changed) nothing is written and the answer is "changed", for the panel to re-open;
 *   - otherwise it writes the payout, one item per covered order and bonus, each order PAID with
 *     paid_at and history through `transition` (R2 re-reads it), the bonuses PAID, the netting
 *     entries of `nettingPlan` (nettingOf; the rest of a clawback carries forward), the audit entry, the
 *     outbox row "payout recorded" with the receipt link, and the claim CONFIRMED.
 *
 * A netting-only payout (transfer 0) is the same command: no receipt token, and the outbox
 * refuses its message. Only the claim's own staff member confirms it. Story 8.8's go/no-go flag
 * refuses every confirm while it is set. A netting entry is stored under the customer id its
 * clawback's original is stored under, as a write-off is, so a clawback's entries never split
 * across a merged customer's ids. An internal disagreement (a bonus that did not pay, netting that
 * disagrees with the payable, a CONFIRMED claim without its payout) rolls everything back as
 * `snapshot_mismatch` with its detail, so the panel says to re-open the payout.
 */
import { randomBytes } from "node:crypto";
import { parseInstant, type Clock, type Instant } from "@cashback/core";
import { sumDong } from "@cashback/money";
import { and, eq } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import type { CommandAudit } from "../../platform/ports/audit.port";
import { dedupKey, type OutboxPort } from "../../platform/ports/outbox.port";
import { orderAwardsFor, payAwards } from "../campaigns/index";
import { markOrderPaid } from "../orders/index";
import { openClaimOf, ownClaim, PayoutClaimError } from "./payout-claim.command";
import { nettingOf, payoutSnapshot, type PayoutSnapshot } from "./payout-snapshot.query";
import { ledgerEntries, payoutClaims, payoutItems, payouts, type PayoutClaimRow, type RecordedPayoutRow } from "./schema";

/** The customer message of a recorded payout (packages/labels/vi/messages.json). */
export const PAYOUT_RECORDED_MESSAGE = "payout_recorded";

export interface ConfirmInput {
  readonly claimId: string;
  /** The snapshot hash of the preview the panel showed. */
  readonly snapshotHash: string;
}

export interface ConfirmDeps {
  readonly clock: Clock;
  readonly by: CommandAudit;
  readonly outbox: OutboxPort;
  /** True while the cutover go/no-go window holds every confirm (Story 8.8 sets it). */
  readonly confirmPaused?: () => boolean;
  /** Tests fix the receipt tokens; production draws 24 random bytes. */
  readonly newReceiptToken?: () => string;
}

export interface RecordedPayout {
  readonly payoutId: number;
  readonly claimId: string;
  readonly customerId: string;
  /** What left the bank; 0 for a netting-only payout. */
  readonly amount: number;
  readonly netted: number;
  readonly nettingOnly: boolean;
  readonly orderCount: number;
  readonly awardCount: number;
  readonly receiptToken: string | null;
  readonly recordedAt: Instant;
}

export type ConfirmOutcome = { readonly kind: "recorded"; readonly payout: RecordedPayout; readonly replay: boolean } | { readonly kind: "changed"; readonly previousAmount: number };

const randomReceiptToken = (): string => randomBytes(24).toString("base64url");

const inconsistent = (detail: string): PayoutClaimError => new PayoutClaimError("snapshot_mismatch", detail);

/** A payout recorded earlier, read back for a replayed confirm. */
function recordedOf(db: LedgerDb, row: RecordedPayoutRow): RecordedPayout {
  const items = db.select({ kind: payoutItems.kind }).from(payoutItems).where(eq(payoutItems.payoutId, row.payoutId)).all();
  const netting = db
    .select({ amount: ledgerEntries.amount })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.payoutId, row.payoutId), eq(ledgerEntries.kind, "NETTING")))
    .all();
  const netted = sumDong(
    netting.map((e) => e.amount),
    "netted",
  );
  return {
    payoutId: row.payoutId,
    claimId: row.claimId ?? "",
    customerId: row.customerId,
    amount: row.transferAmount,
    netted,
    nettingOnly: row.transferAmount === 0,
    orderCount: items.filter((i) => i.kind === "ORDER").length,
    awardCount: items.filter((i) => i.kind === "AWARD").length,
    receiptToken: row.receiptToken,
    recordedAt: parseInstant(row.recordedAt ?? ""),
  };
}

const payoutOfClaim = (db: LedgerDb, claimId: string): RecordedPayoutRow | undefined => db.select().from(payouts).where(eq(payouts.claimId, claimId)).get();

function insertPayout(db: LedgerDb, claim: PayoutClaimRow, snapshot: PayoutSnapshot, deps: ConfirmDeps): RecordedPayoutRow {
  const amount = snapshot.balance.payable;
  return db
    .insert(payouts)
    .values({
      customerId: snapshot.customerId,
      status: "RECORDED",
      transferAmount: amount,
      transferReference: amount === 0 ? null : claim.transferReference,
      receiptToken: amount === 0 ? null : (deps.newReceiptToken ?? randomReceiptToken)(),
      bankLastFour: amount === 0 ? null : (snapshot.bank?.lastFour ?? null),
      claimId: claim.claimId,
      recordedBy: deps.by.actor.id,
      recordedAt: deps.clock.now(),
      origin: "CONFIRM",
    })
    .returning()
    .get();
}

function insertItems(db: LedgerDb, payoutId: number, snapshot: PayoutSnapshot): void {
  const lines = [
    ...snapshot.orders.map((o) => ({ kind: "ORDER" as const, orderId: o.orderId, awardId: null, amount: o.cashback })),
    ...snapshot.bonuses.map((b) => ({ kind: "AWARD" as const, orderId: b.orderId, awardId: b.awardId, amount: b.amount })),
  ];
  lines.forEach((line, i) => db.insert(payoutItems).values({ payoutId, lineNo: i + 1, ...line }).run());
}

/** Every covered order PAID through `transition` and every covered bonus PAID; anything else rolls the confirm back. */
function payLines(db: LedgerDb, snapshot: PayoutSnapshot, deps: ConfirmDeps): void {
  const awards = orderAwardsFor(db, deps.clock, deps.by);
  for (const o of snapshot.orders) markOrderPaid(db, { orderId: o.orderId, customerId: o.customerId }, { clock: deps.clock, by: deps.by, outbox: deps.outbox, awards });
  const awardIds = snapshot.bonuses.map((b) => b.awardId);
  if (payAwards(db, deps.clock, awardIds, deps.by) !== awardIds.length) throw inconsistent("a covered bonus was not paid");
}

function writeNetting(db: LedgerDb, payoutId: number, snapshot: PayoutSnapshot, deps: ConfirmDeps): number {
  const plan = nettingOf(snapshot);
  if (plan.transfer !== snapshot.balance.payable) throw inconsistent("netting disagrees with the payable balance");
  const lineOf = new Map(snapshot.clawbacks.map((c) => [c.clawbackId, c]));
  for (const entry of plan.entries) {
    const line = lineOf.get(entry.clawbackId);
    if (line === undefined) throw inconsistent(`netting names an unknown clawback ${entry.clawbackId}`);
    db.insert(ledgerEntries)
      .values({ customerId: line.customerId, clawbackId: entry.clawbackId, kind: "NETTING", amount: entry.amount, orderId: line.orderId, payoutId, reason: "payout_netting", createdAt: deps.clock.now(), createdBy: deps.by.actor.id })
      .run();
  }
  return plan.netted;
}

function record(db: LedgerDb, claim: PayoutClaimRow, snapshot: PayoutSnapshot, deps: ConfirmDeps): RecordedPayout {
  const row = insertPayout(db, claim, snapshot, deps);
  insertItems(db, row.payoutId, snapshot);
  payLines(db, snapshot, deps);
  const netted = writeNetting(db, row.payoutId, snapshot, deps);
  const now = deps.clock.now();
  db.update(payoutClaims).set({ status: "CONFIRMED", confirmedAt: now, lastActiveAt: now }).where(eq(payoutClaims.claimId, claim.claimId)).run();
  const nettingOnly = row.transferAmount === 0;
  deps.by.audit.record({
    actor: deps.by.actor,
    event: "payouts.payout.recorded",
    entityId: String(row.payoutId),
    payload: { payoutId: row.payoutId, claimId: claim.claimId, customerId: snapshot.customerId, amount: row.transferAmount, netted, orders: snapshot.orders.length, awards: snapshot.bonuses.length, nettingOnly, ...(claim.bankFingerprint === null ? {} : { bankFingerprint: claim.bankFingerprint }), snapshotHash: claim.snapshotHash },
  });
  deps.outbox.enqueue({
    dedupKey: dedupKey("payout", String(row.payoutId), "recorded"),
    customerId: snapshot.customerId,
    messageKey: PAYOUT_RECORDED_MESSAGE,
    params: { payoutId: row.payoutId, amount: row.transferAmount, receiptToken: row.receiptToken ?? "" },
    transferAmount: row.transferAmount,
  });
  return {
    payoutId: row.payoutId,
    claimId: claim.claimId,
    customerId: row.customerId,
    amount: row.transferAmount,
    netted,
    nettingOnly,
    orderCount: snapshot.orders.length,
    awardCount: snapshot.bonuses.length,
    receiptToken: row.receiptToken,
    recordedAt: parseInstant(row.recordedAt ?? now),
  };
}

/** Confirms the calling staff member's claim; run inside `tx`. */
export function confirmPayout(db: LedgerDb, input: ConfirmInput, deps: ConfirmDeps): ConfirmOutcome {
  if (deps.confirmPaused?.() === true) throw new PayoutClaimError("confirm_paused");
  const claim = ownClaim(db, input.claimId, deps);
  if (claim.status === "CONFIRMED") {
    const done = payoutOfClaim(db, claim.claimId);
    if (done === undefined) throw inconsistent(`claim ${claim.claimId} is CONFIRMED without a payout`);
    return { kind: "recorded", payout: recordedOf(db, done), replay: true };
  }
  if (claim.status === "ABANDONED" && openClaimOf(db, claim.customerId) !== undefined) throw new PayoutClaimError("other_claim_open");
  const snapshot = payoutSnapshot(db, claim.customerId);
  if (snapshot === null || snapshot.hash !== claim.snapshotHash || input.snapshotHash !== claim.snapshotHash) return { kind: "changed", previousAmount: claim.amount };
  return { kind: "recorded", payout: record(db, claim, snapshot, deps), replay: false };
}
