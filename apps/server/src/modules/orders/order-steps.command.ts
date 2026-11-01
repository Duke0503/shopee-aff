/**
 * What every status change of an order writes beside the order itself (AD-7, AD-16, AD-17): one
 * history row and one audit entry per step, and, for the changes a customer is told (Story 6.6),
 * one outbox row keyed `order:<id>:<event>`, so a customer is told each event once however often
 * the step is taken (a retried run, overlapping report windows). The guest account (HOUSE) and an
 * order with no customer are never told (D5); an erased customer is refused by the outbox.
 *
 * Told: recorded, approved (with the cashback, and, D11: never a date, a request for a bank
 * account when the customer has none, or a reminder to confirm the one waiting for it), rejected
 * (with its reason code), reversed (a cancel after approval), and a wrong rejection reopened. Not
 * told: a freeze and its resolution back to where it was (a hold the customer need not act on,
 * D55), and the steps a payout confirm or void tells per payout. An approval reached again after a
 * freeze has the key of the first approval, so it is never told twice.
 *
 * Each reopen of a wrong rejection (D38) starts a new lifecycle of the order: its events are
 * keyed `order:<id>@<n>:<event>` after the n-th reopen, so a rejection after a reopen is told once
 * again, while the first lifecycle keeps the plain keys the cutover seeded (D46).
 *
 * The notice carries the target status in its parameters; the assistant writes "update on order
 * X: <status sentence>" from the status registry, then the notice's own detail, so each status
 * sentence lives once, in status-flows.md and the registry (AD-10).
 */
import type { Clock, OrderStatus } from "@cashback/core";
import { and, eq } from "drizzle-orm";

import type { LedgerDb } from "../../platform/db/ledger";
import type { AuditValue, CommandAudit } from "../../platform/ports/audit.port";
import { dedupKey, type OutboxPort } from "../../platform/ports/outbox.port";
import { customerBankState } from "../identity/index";
import type { Step } from "./domain/transition";
import { orderStatusHistory } from "./schema";

/** The event of a step, as the audit names it (`orders.order.<event>`) and the outbox keys it. */
export function stepEvent([from, to]: Step): string {
  switch (to) {
    case "AWAITING_APPROVAL":
      return from === null ? "recorded" : "reopened";
    case "APPROVED":
      return from === "PAID" ? "payout_voided" : from === "FROZEN" ? "restored" : "approved";
    case "FROZEN":
      return "frozen";
    case "REJECTED":
      return "rejected";
    case "REVERSED":
      return "reversed";
    case "PAID":
      return "paid";
  }
}

/**
 * The message keys of the order notices. `notice_order` frames the status sentence alone; the
 * others are the detail written after it.
 */
export const ORDER_NOTICES = {
  plain: "notice_order",
  recorded: "notice_order_recorded",
  approved: "notice_order_approved",
  approvedAddBank: "notice_order_approved_add_bank",
  approvedBankHeld: "notice_order_approved_bank_held",
} as const;

const APPROVED_BY_BANK = { none: ORDER_NOTICES.approvedAddBank, held: ORDER_NOTICES.approvedBankHeld, confirmed: ORDER_NOTICES.approved } as const;

type Notice = { readonly event: string; readonly messageKey: string };

function noticeOf(db: LedgerDb, [from, to]: Step, customerId: string): Notice | null {
  switch (to) {
    case "AWAITING_APPROVAL":
      if (from === null) return { event: "recorded", messageKey: ORDER_NOTICES.recorded };
      return from === "REJECTED" ? { event: "reopened", messageKey: ORDER_NOTICES.recorded } : null;
    case "APPROVED":
      return from === "PAID" ? null : { event: "approved", messageKey: APPROVED_BY_BANK[customerBankState(db, customerId)] };
    case "REJECTED":
      return { event: "rejected", messageKey: ORDER_NOTICES.plain };
    case "REVERSED":
      return from === "PAID" ? null : { event: "reversed", messageKey: ORDER_NOTICES.plain };
    case "FROZEN":
    case "PAID":
      return null;
  }
}

/** How many times a wrong rejection of the order was reopened: its lifecycle number. */
function reopens(db: LedgerDb, orderId: string): number {
  return db
    .select({ orderId: orderStatusHistory.orderId })
    .from(orderStatusHistory)
    .where(and(eq(orderStatusHistory.orderId, orderId), eq(orderStatusHistory.fromStatus, "REJECTED"), eq(orderStatusHistory.toStatus, "AWAITING_APPROVAL")))
    .all().length;
}

/** The outbox key of an order event in the order's current lifecycle. */
export function orderEventKey(db: LedgerDb, orderId: string, event: string): string {
  const n = reopens(db, orderId);
  return dedupKey("order", n === 0 ? orderId : `${orderId}@${n}`, event);
}

export interface OrderSteps {
  readonly orderId: string;
  readonly customerId: string | null;
  readonly guest: boolean;
  readonly steps: readonly Step[];
  /** Why, for the history row: a cancel or review reason, or what observed the change. */
  readonly reason: string;
  /** The history reason of a step to APPROVED: the approval's settlement period and withheld setting. */
  readonly approvalReason?: string;
  /** Ids, statuses and amounts for the audit payload. */
  readonly facts: Readonly<Record<string, AuditValue>>;
  /** Ids, amounts and the cancel reason code for the customer message. */
  readonly params: Readonly<Record<string, string | number>>;
  /** Steps whose customer message another command sends (a payout confirm tells per payout). */
  readonly silentEvents?: readonly string[];
}

export interface StepWriters {
  readonly clock: Clock;
  readonly by: CommandAudit;
  readonly outbox: OutboxPort;
}

export function recordSteps(db: LedgerDb, s: OrderSteps, w: StepWriters): void {
  const at = w.clock.now();
  for (const step of s.steps) {
    const [from, to] = step;
    const event = stepEvent(step);
    const reason = to === "APPROVED" ? (s.approvalReason ?? s.reason) : s.reason;
    db.insert(orderStatusHistory).values({ orderId: s.orderId, fromStatus: from, toStatus: to, actor: w.by.actor.id, reason, changedAt: at }).run();
    w.by.audit.record({ actor: w.by.actor, event: `orders.order.${event}`, entityId: s.orderId, payload: { orderId: s.orderId, customerId: s.customerId, from, to, ...s.facts } });
    if (s.customerId === null || s.guest || s.silentEvents?.includes(event)) continue;
    const notice = noticeOf(db, step, s.customerId);
    if (notice === null) continue;
    w.outbox.enqueue({ dedupKey: orderEventKey(db, s.orderId, notice.event), customerId: s.customerId, messageKey: notice.messageKey, params: { orderId: s.orderId, status: to, ...s.params } });
  }
}

/**
 * An imported order whose live platform mapped to no network gets the network of the first report
 * row that holds it, recorded as a history row (its status unchanged) and an audit entry.
 */
export function recordNetworkSet(db: LedgerDb, o: { orderId: string; status: OrderStatus; network: string }, w: Omit<StepWriters, "outbox">): void {
  db.insert(orderStatusHistory).values({ orderId: o.orderId, fromStatus: o.status, toStatus: o.status, actor: w.by.actor.id, reason: `network set to ${o.network} by its report`, changedAt: w.clock.now() }).run();
  w.by.audit.record({ actor: w.by.actor, event: "orders.order.network_set", entityId: o.orderId, payload: { orderId: o.orderId, network: o.network } });
}
