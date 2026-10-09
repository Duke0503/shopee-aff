import { notifyPayouts } from "../modules/ledger/application/notify-payouts.use-case";
import { notifyOrderChanges } from "../modules/orders/application/notify-order-changes.use-case";
import type { Db } from "../shared/database/connection";
import type { DeliveryPort } from "../notifications/delivery";
import type { Messages } from "../notifications/messages";
import type { ScheduledJob } from "./job-runner";

/**
 * The notify loop. Every 10 s the server tells customers what changed while
 * they were not looking. Each step stands alone: campaign changes run first
 * (so an approval already knows about its bonus), then order changes, then
 * payouts. A failing step does not skip the others, but the pass still
 * reports failure so the alert-after-3 rule can fire.
 */
export interface NotifyJobDeps {
  db: Db;
  delivery: DeliveryPort;
  messages: Messages;
  now: () => string;
  intervalMs: number;
}

/** Run each step in turn; throw once at the end if any failed. */
export async function runSteps(steps: Array<() => Promise<unknown>>): Promise<void> {
  const errors: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) throw errors[0];
}

export function createNotifyJob(deps: NotifyJobDeps): ScheduledJob {
  return {
    name: "notify",
    intervalMs: deps.intervalMs,
    runOnStart: true,
    run: () =>
      runSteps([
        () =>
          notifyOrderChanges({ db: deps.db, delivery: deps.delivery, messages: deps.messages }),
        () =>
          notifyPayouts({
            db: deps.db,
            delivery: deps.delivery,
            messages: deps.messages,
            now: deps.now,
          }),
      ]),
  };
}
