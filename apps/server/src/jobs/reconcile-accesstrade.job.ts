import { splitCommission } from "@mmo/money";

import { reconcileAccessTrade } from "../modules/affiliate/application/reconcile-accesstrade.use-case";
import type { AccessTradeOrdersPort } from "../modules/affiliate/providers/accesstrade.client";
import type { Db } from "../shared/database/connection";
import type { ScheduledJob } from "./job-runner";

const LOOKBACK_DAYS = 30;

/**
 * Pull AccessTrade's transaction report and feed it to reconciliation. Every
 * shop goes through the same `packages/money` split, so a TikTok or Lazada
 * approval earns exactly what a Shopee one would, and an order is never
 * approved from an estimate.
 */
export interface ReconcileAccessTradeJobDeps {
  db: Db;
  orders: AccessTradeOrdersPort;
  now: () => string;
  intervalMs: number;
  cashbackRate: number;
}

export function createAccessTradeReconcileJob(deps: ReconcileAccessTradeJobDeps): ScheduledJob {
  return {
    name: "reconcile-accesstrade",
    intervalMs: deps.intervalMs,
    run: async () => {
      const transactions = await deps.orders.fetchTransactions(LOOKBACK_DAYS);
      if (transactions.length === 0) return;
      reconcileAccessTrade(deps.db, {
        nowIso: deps.now(),
        transactions,
        cashbackFor: (commission) => splitCommission(commission, deps.cashbackRate, false).customerReceives,
      });
    },
  };
}
