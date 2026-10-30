import { notifyFailedLinks } from "../modules/affiliate/application/notify-failed-links.use-case";
import { notifyLateLinks } from "../modules/affiliate/application/notify-late-links.use-case";
import { notifyPayouts } from "../modules/ledger/application/notify-payouts.use-case";
import { notifyCampaignChanges } from "../modules/orders/application/notify-campaign-changes.use-case";
import { notifyOrderChanges } from "../modules/orders/application/notify-order-changes.use-case";
import type { Db } from "../shared/database/connection";
import type { DeliveryPort } from "../notifications/delivery";
import type { Messages } from "../notifications/messages";
import type { ScheduledJob } from "./job-runner";

/**
 * The notify loop. Every 10 s the server tells customers what changed while
 * they were not looking. Each step stands alone: campaign slots are settled
 * first (so an approval already knows its bonus), then order news, then money
 * sent, then apologies for links we could not make, then links the chat never
 * collected. A failing step does not skip the others, but the pass still
 * reports failure so the alert-after-3 rule can fire.
 */
export interface NotifyJobDeps {
  db: Db;
  delivery: DeliveryPort;
  messages: Messages;
  now: () => string;
  intervalMs: number;
  /** The advertised cashback rate, e.g. 0.8 for "80%". */
  cashbackRate: number;
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
          notifyCampaignChanges({
            db: deps.db,
            delivery: deps.delivery,
            messages: deps.messages,
            now: deps.now,
          }),
        () =>
          notifyOrderChanges({ db: deps.db, delivery: deps.delivery, messages: deps.messages }),
        () =>
          notifyPayouts({
            db: deps.db,
            delivery: deps.delivery,
            messages: deps.messages,
            now: deps.now,
          }),
        () =>
          notifyFailedLinks({
            db: deps.db,
            delivery: deps.delivery,
            messages: deps.messages,
            now: deps.now,
          }),
        () =>
          notifyLateLinks({
            db: deps.db,
            delivery: deps.delivery,
            messages: deps.messages,
            now: deps.now,
            cashbackRate: deps.cashbackRate,
          }),
      ]),
  };
}
