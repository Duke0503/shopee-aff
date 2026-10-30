/**
 * The composition of a report apply (AD-1, AD-8): the orders command's ports bound to one
 * transaction's handle. Audit and alerts are the operations module's, the outbox messaging's,
 * clawbacks and claims payouts', awards campaigns'. The `orders.order.recorded` handler of
 * linking (a request becomes CONVERTED) comes with Epic 5; until then the event has no listener.
 * Stories 3.7 and 3.8 run each order through `applyReportRow` with these, one `tx` per order.
 */
import type { Clock } from "@cashback/core";

import { orderAwardsFor } from "../modules/campaigns/index";
import { outboxFor } from "../modules/messaging/index";
import { alertsFor, commandAudit } from "../modules/operations/index";
import type { ApplyDeps, OrderEventsPort } from "../modules/orders/index";
import { orderPayoutsFor } from "../modules/payouts/index";
import type { LedgerDb } from "../platform/db/ledger";
import type { Actor } from "../platform/ports/audit.port";

/** The actor of the reconciliation runs (AD-17). */
export const RECONCILE_ACTOR: Actor = { kind: "system", id: "reconcile" };

const NO_LISTENER: OrderEventsPort = { recorded: () => undefined };

export interface ApplyOptions {
  /** Production never credits a DEV sub_id (AD-25). */
  readonly production: boolean;
  readonly actor?: Actor;
  readonly events?: OrderEventsPort;
}

export function applyDepsFor(db: LedgerDb, clock: Clock, options: ApplyOptions): ApplyDeps {
  const by = commandAudit(db, clock, options.actor ?? RECONCILE_ACTOR);
  const outbox = outboxFor(db, clock, by);
  return {
    clock,
    by,
    outbox,
    alerts: alertsFor(db, clock),
    payouts: orderPayoutsFor(db, { clock, by, outbox }),
    awards: orderAwardsFor(db, clock, by),
    events: options.events ?? NO_LISTENER,
    production: options.production,
  };
}
