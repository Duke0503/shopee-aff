import type { Db } from "../../../shared/database/connection";
import { findCustomerIdByAnyId } from "../../identity";
import {
  reconcileReport,
  type AttributionLookups,
  type ReconcileSummary,
  type ReportRowInput,
} from "../../orders";
import { normalizeTransactions, type AccessTradeTransaction } from "../domain/accesstrade-order";
import { findLinkRequestOwner } from "../infrastructure/link-request.repository";

/**
 * Ingest AccessTrade's transaction report. AccessTrade is the only source for
 * TikTok Shop and Lazada, and it reports each purchase as one or more
 * commission lines, so the lines are grouped into orders first. Everything
 * after that is the shared reconciliation: never guess a customer, never pay
 * twice, and never approve without an approved commission.
 */
export interface ReconcileAccessTradeInput {
  nowIso: string;
  transactions: AccessTradeTransaction[];
  /**
   * One approved commission -> the customer's cashback. The owner's decision
   * B5 (the TikTok formula) lands here, so no money rule is guessed.
   */
  cashbackFor: (approvedCommission: number) => number;
}

/** The evidence map Orders' attribution rule needs, built from this database. */
export function accessTradeLookups(db: Db): AttributionLookups {
  return {
    findCustomer: (anyId) => findCustomerIdByAnyId(db, anyId),
    requestOwner: (requestId) => findLinkRequestOwner(db, requestId),
  };
}

export function reconcileAccessTrade(db: Db, input: ReconcileAccessTradeInput): ReconcileSummary {
  const rows: ReportRowInput[] = normalizeTransactions(input.transactions).map((order) => ({
    orderId: order.orderId,
    subId1: order.subId1,
    subId2: order.subId2,
    status: order.status,
    approvedCommission: order.approvedCommissionVnd,
    orderValueVnd: order.orderValueVnd,
    estimatedCommissionVnd: order.estimatedCommissionVnd,
    recordedAt: order.orderTime,
    platform: order.platform,
  }));

  return reconcileReport(db, {
    source: "accesstrade",
    nowIso: input.nowIso,
    rows,
    lookups: accessTradeLookups(db),
    cashbackFor: input.cashbackFor,
  });
}
