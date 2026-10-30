/**
 * What every status change of an order writes beside the order itself (AD-7, AD-16, AD-17): one
 * history row and one audit entry per step, and one outbox row telling the customer, keyed
 * `order:<id>:<event>` so a customer is told each event once however often the step is taken. The
 * guest account (HOUSE) and an order with no customer are never told (D5). Call inside the
 * command's transaction, after `transition` gave the steps.
 */
import { STATUS_REGISTRY, type Clock, type OrderStatus } from "@cashback/core";

import type { LedgerDb } from "../../platform/db/ledger";
import type { AuditValue, CommandAudit } from "../../platform/ports/audit.port";
import { dedupKey, type OutboxPort } from "../../platform/ports/outbox.port";
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

const messageKeyOf = (status: OrderStatus): string | null => STATUS_REGISTRY.order.statuses.find((s) => s.value === status)?.messageKey ?? null;

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
  /** Ids and amounts for the customer message. */
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
    const messageKey = messageKeyOf(to);
    if (s.customerId === null || s.guest || messageKey === null || s.silentEvents?.includes(event)) continue;
    w.outbox.enqueue({ dedupKey: dedupKey("order", s.orderId, event), customerId: s.customerId, messageKey, params: { orderId: s.orderId, ...s.params } });
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
