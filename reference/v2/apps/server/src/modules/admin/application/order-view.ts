import { inArray } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { linkRequests } from "../../../shared/database/schema";
import { estimateProductName } from "../../affiliate";
import { orderBreakdown, type BreakdownStatus, type OrderBreakdown } from "../domain/order-breakdown";

/**
 * One order, as a staff screen explains it. Shared by the customer's page and
 * the order list, so the same order can never be described two different ways.
 *
 * Every amount comes from the stored columns through `orderBreakdown`; nothing
 * here recalculates a payout.
 */
export interface OrderView {
  orderId: string;
  status: string;
  platform: string;
  settlementStatus: string;
  orderValueVnd: number | null;
  estimatedCommissionVnd: number | null;
  approvedCommissionVnd: number | null;
  /** The saved cashback, or — before approval — the estimate the customer sees. */
  cashbackVnd: number;
  rejectionReason: string | null;
  recordedAt: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  productName: string;
  sourceUrl: string | null;
  breakdown: OrderBreakdown;
}

/** The order columns the view reads; any superset of these will do. */
export interface OrderFields {
  orderId: string;
  orderValue: number | null;
  estimatedCommission: number | null;
  approvedCommission: number | null;
  cashbackAmount: number | null;
  status: string;
  rejectionReason: string | null;
  recordedAt: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  platform: string;
  settlementStatus: string;
}

/** The link request behind an order: where it came from and what it was. */
export interface OrderRequest {
  estimateDetail: string | null;
  sourceUrl: string;
}

/** The link requests behind these orders, in one read instead of one each. */
export function requestsForOrders(db: Db, requestIds: string[]): Map<string, OrderRequest> {
  if (requestIds.length === 0) return new Map();
  const rows = db
    .select({
      requestId: linkRequests.requestId,
      estimateDetail: linkRequests.estimateDetail,
      sourceUrl: linkRequests.sourceUrl,
    })
    .from(linkRequests)
    .where(inArray(linkRequests.requestId, requestIds))
    .all();
  return new Map(rows.map((row) => [row.requestId, row]));
}

export function orderView(
  order: OrderFields,
  request: OrderRequest | undefined,
  rate: number,
  withheld: boolean,
): OrderView {
  const breakdown = orderBreakdown({
    status: order.status as BreakdownStatus,
    approvedCommissionVnd: order.approvedCommission,
    estimatedCommissionVnd: order.estimatedCommission,
    savedCashbackVnd: order.cashbackAmount,
    cashbackRate: rate,
    periodIsWithheld: withheld,
  });

  return {
    orderId: order.orderId,
    status: order.status,
    platform: order.platform,
    settlementStatus: order.settlementStatus,
    orderValueVnd: order.orderValue,
    estimatedCommissionVnd: order.estimatedCommission,
    approvedCommissionVnd: order.approvedCommission,
    cashbackVnd: order.cashbackAmount ?? breakdown.cashbackVnd,
    rejectionReason: order.rejectionReason,
    recordedAt: order.recordedAt,
    approvedAt: order.approvedAt,
    paidAt: order.paidAt,
    productName: estimateProductName(request?.estimateDetail ?? null),
    sourceUrl: request?.sourceUrl ?? null,
    breakdown,
  };
}
