/**
 * The payouts side of applying a report row (AD-6, AD-7, D30, D35, D39, D42, D55): the orders
 * module's `OrderPayoutsPort`, bound to the apply's transaction. A clawback is a series of
 * insert-only `ledger_entries` sharing one clawback id; this writes only its negative original
 * (`<orderId>-<n>`, the n-th clawback of the order). What the order's originals already took is
 * read back so `transition` never claws back the same cashback twice. Payout claims arrive with
 * Story 4.7 (`payout_claims`); until then no claim exists, so none can be open.
 *
 * Opening a clawback tells the customer once, in the same transaction: the outbox row is keyed
 * `clawback:<id>:opened`, so a retried or repeated apply never tells twice, and its sentence
 * (status-flows.md §2) names the order and the amount deducted at the next payout, never a date.
 * The netting itself is the payout's (Epic 4, AD-6).
 */
import type { Clock } from "@cashback/core";
import { sumDong } from "@cashback/money";
import { and, eq } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import type { CommandAudit } from "../../platform/ports/audit.port";
import { dedupKey, type OutboxPort } from "../../platform/ports/outbox.port";
import type { ClawbackRequest, OrderPayoutsPort } from "../orders/index";
import { ledgerEntries } from "./schema";

function originals(db: LedgerDb, orderId: string): { clawbackId: string; amount: number }[] {
  return db
    .select({ clawbackId: ledgerEntries.clawbackId, amount: ledgerEntries.amount })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.orderId, orderId), eq(ledgerEntries.kind, "CLAWBACK")))
    .all();
}

/** What the order's clawback originals took, positive (their entries are negative). */
export function clawedBackOn(db: LedgerDb, orderId: string): number {
  return sumDong(originals(db, orderId).map((e) => -e.amount), "clawback");
}

/** The customer sentence of a new clawback: a cancel after payout (§2) or a commission drop after it (D55). */
export const CLAWBACK_MESSAGE_KEYS = { cancel: "clawback_opened", partial: "clawback_commission_dropped" } as const;

export interface ClawbackWriters {
  readonly clock: Clock;
  readonly by: CommandAudit;
  readonly outbox: OutboxPort;
}

export function openClawback(db: LedgerDb, request: ClawbackRequest, w: ClawbackWriters): string {
  const { clock, by } = w;
  if (!Number.isSafeInteger(request.amount) || request.amount <= 0) throw new RangeError(`a clawback takes back a positive whole dong amount, received ${request.amount}`);
  const clawbackId = `${request.orderId}-${new Set(originals(db, request.orderId).map((e) => e.clawbackId)).size + 1}`;
  const reason = request.partial ? "commission_drop_after_payout" : "cancel_after_payout";
  db.insert(ledgerEntries)
    .values({ customerId: request.customerId, clawbackId, kind: "CLAWBACK", amount: -request.amount, orderId: request.orderId, reason, createdAt: clock.now(), createdBy: by.actor.id })
    .run();
  by.audit.record({ actor: by.actor, event: "payouts.clawback.opened", entityId: clawbackId, payload: { clawbackId, orderId: request.orderId, customerId: request.customerId, amount: request.amount, reason } });
  w.outbox.enqueue({
    dedupKey: dedupKey("clawback", clawbackId, "opened"),
    customerId: request.customerId,
    messageKey: request.partial ? CLAWBACK_MESSAGE_KEYS.partial : CLAWBACK_MESSAGE_KEYS.cancel,
    params: { clawbackId, orderId: request.orderId, amount: request.amount },
  });
  return clawbackId;
}

/** The orders port bound to one transaction's handle. */
export function orderPayoutsFor(db: LedgerDb, w: ClawbackWriters): OrderPayoutsPort {
  return {
    coveredByOpenClaim: () => false,
    clawedBack: (orderId) => clawedBackOn(db, orderId),
    openClawback: (request) => openClawback(db, request, w),
  };
}
