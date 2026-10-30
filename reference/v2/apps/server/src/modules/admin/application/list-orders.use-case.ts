import { and, eq, sql, type SQL } from "drizzle-orm";

import { cashbackRate } from "../../../shared/config/cashback-rate";
import { periodIsWithheld } from "../../../shared/config/period-is-withheld";
import type { Db } from "../../../shared/database/connection";
import { customers, linkRequests, orders } from "../../../shared/database/schema";
import { orderView, type OrderView } from "./order-view";
import { paginationMeta, type Page } from "./pagination";

/**
 * The order list for the staff area. Ports `_admin_orders`: one row per order,
 * carrying the same money explanation the customer's own page shows, so the
 * owner can see at a glance which orders already carry approved money and which
 * are still only an estimate.
 *
 * The rows come from STORED columns; the explanation is `orderBreakdown`, the
 * one every other screen uses.
 */
export interface OrdersQuery extends Page {
  search: string;
  status: string;
  settlementStatus: string;
  platform: string;
  customerId: string;
  fromDate: string;
  toDate: string;
  sortBy: string;
  sortOrder: "asc" | "desc";
}

export interface AdminOrderRow extends OrderView {
  customerId: string | null;
  customerCode: string | null;
  customerName: string | null;
}

/** What the screen may filter by; anything else means "no filter". */
const STATUSES = new Set(["awaiting_approval", "approved", "paid", "rejected"]);
const SETTLEMENTS = new Set(["settled", "unsettled", "processing"]);
const PLATFORMS = new Set(["shopee", "tiktok"]);

/** Where an order sits in time: when it was recorded, or approved if it was not. */
const WHEN = sql`coalesce(${orders.recordedAt}, ${orders.approvedAt})`;

function orderBy(query: OrdersQuery): SQL {
  const ascending = query.sortOrder === "asc";
  const direction = ascending ? sql`asc` : sql`desc`;
  /** A screen sorted ascending must not open on a page of blanks. */
  const amount = (column: SQL): SQL =>
    ascending
      ? sql`case when ${column} is null then 1 else 0 end, ${column} asc`
      : sql`${column} desc`;

  switch (query.sortBy) {
    case "order_value":
      return amount(sql`${orders.orderValue}`);
    case "commission":
    case "estimated_commission":
      return amount(sql`${orders.estimatedCommission}`);
    case "cashback":
    case "cashback_amount":
      return amount(sql`${orders.cashbackAmount}`);
    case "order_id":
      return sql`${orders.orderId} ${direction}`;
    case "status":
      return sql`${orders.status} ${direction}`;
    case "customer":
      return sql`coalesce(${customers.displayName}, ${orders.customerId}) ${direction}`;
    case "date":
    case "recorded_at":
      return sql`${WHEN} ${direction}`;
    default:
      return sql`${WHEN} desc`;
  }
}

function whereFor(query: OrdersQuery) {
  const conditions = [];
  if (query.search) {
    const pattern = `%${query.search}%`;
    conditions.push(
      sql`(lower(${orders.orderId}) like ${pattern}
        or lower(coalesce(${orders.customerId}, '')) like ${pattern}
        or lower(coalesce(${customers.customerCode}, '')) like ${pattern}
        or lower(coalesce(${customers.displayName}, '')) like ${pattern}
        or lower(coalesce(${linkRequests.estimateDetail}, '')) like ${pattern})`,
    );
  }
  if (STATUSES.has(query.status)) conditions.push(eq(orders.status, query.status));
  if (SETTLEMENTS.has(query.settlementStatus)) {
    conditions.push(eq(orders.settlementStatus, query.settlementStatus));
  }
  if (PLATFORMS.has(query.platform)) conditions.push(eq(orders.platform, query.platform));
  if (query.customerId) conditions.push(eq(orders.customerId, query.customerId));
  if (query.fromDate) conditions.push(sql`${WHEN} >= ${query.fromDate}`);
  if (query.toDate) conditions.push(sql`${WHEN} <= ${query.toDate}`);
  return and(...conditions);
}

export function listOrders(
  db: Db,
  query: OrdersQuery,
): { orders: AdminOrderRow[]; pagination: ReturnType<typeof paginationMeta> } {
  const where = whereFor(query);
  const total =
    db
      .select({ n: sql<number>`count(*)` })
      .from(orders)
      .leftJoin(customers, eq(customers.customerId, orders.customerId))
      .leftJoin(linkRequests, eq(linkRequests.requestId, orders.requestId))
      .where(where)
      .get()?.n ?? 0;

  const rate = cashbackRate();
  const withheld = periodIsWithheld();
  const rows = db
    .select({
      orderId: orders.orderId,
      customerId: orders.customerId,
      customerCode: customers.customerCode,
      customerName: customers.displayName,
      orderValue: orders.orderValue,
      estimatedCommission: orders.estimatedCommission,
      approvedCommission: orders.approvedCommission,
      cashbackAmount: orders.cashbackAmount,
      status: orders.status,
      rejectionReason: orders.rejectionReason,
      recordedAt: orders.recordedAt,
      approvedAt: orders.approvedAt,
      paidAt: orders.paidAt,
      platform: orders.platform,
      settlementStatus: orders.settlementStatus,
      estimateDetail: linkRequests.estimateDetail,
      sourceUrl: linkRequests.sourceUrl,
    })
    .from(orders)
    .leftJoin(customers, eq(customers.customerId, orders.customerId))
    .leftJoin(linkRequests, eq(linkRequests.requestId, orders.requestId))
    .where(where)
    .orderBy(orderBy(query))
    .limit(query.limit)
    .offset(query.offset)
    .all()
    .map((row) => ({
      ...orderView(
        row,
        row.sourceUrl === null ? undefined : { estimateDetail: row.estimateDetail, sourceUrl: row.sourceUrl },
        rate,
        withheld,
      ),
      customerId: row.customerId,
      customerCode: row.customerCode,
      customerName: row.customerName,
    }));

  return { orders: rows, pagination: paginationMeta(query, total) };
}
