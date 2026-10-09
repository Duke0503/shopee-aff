import { inArray, sql } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { customers, orders } from "../../../shared/database/schema";

/**
 * The dashboard numbers. Ports the summary part of `_admin_metrics`. Every
 * figure is a sum or a count of STORED columns — the same columns the ledger
 * writes — so the dashboard can never invent a number the ledger disagrees
 * with. Money is never recalculated here.
 */
export interface MetricsSummary {
  totalCustomers: number;
  totalEmployees: number;
  ordersTotal: number;
  ordersAwaiting: number;
  ordersApproved: number;
  ordersPaid: number;
  ordersRejected: number;
  gmvVnd: number;
  grossCommissionVnd: number;
  cashbackPipelineVnd: number;
  cashbackReadyVnd: number;
  cashbackPaidVnd: number;
}

export interface MetricsTrend {
  day: string;
  ordersCount: number;
  gmvVnd: number;
  commissionVnd: number;
  cashbackVnd: number;
}

export interface Metrics {
  summary: MetricsSummary;
  trends: MetricsTrend[];
}

function countCustomers(db: Db, roles: string[]): number {
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(customers)
      .where(inArray(customers.role, roles))
      .get()?.n ?? 0
  );
}

function orderSummary(db: Db): MetricsSummary {
  const row = db
    .select({
      total: sql<number>`count(*)`,
      awaiting: sql<number>`coalesce(sum(case when ${orders.status} = 'awaiting_approval' then 1 else 0 end), 0)`,
      approved: sql<number>`coalesce(sum(case when ${orders.status} = 'approved' then 1 else 0 end), 0)`,
      paid: sql<number>`coalesce(sum(case when ${orders.status} = 'paid' then 1 else 0 end), 0)`,
      rejected: sql<number>`coalesce(sum(case when ${orders.status} = 'rejected' then 1 else 0 end), 0)`,
      gmvVnd: sql<number>`coalesce(sum(${orders.orderValue}), 0)`,
      grossCommissionVnd: sql<number>`coalesce(sum(case when ${orders.status} != 'rejected' then coalesce(${orders.approvedCommission}, ${orders.estimatedCommission}, 0) else 0 end), 0)`,
      cashbackPipelineVnd: sql<number>`coalesce(sum(case when ${orders.status} = 'awaiting_approval' then coalesce(${orders.cashbackAmount}, 0) else 0 end), 0)`,
      cashbackReadyVnd: sql<number>`coalesce(sum(case when ${orders.status} = 'approved' and ${orders.paidAt} is null then coalesce(${orders.cashbackAmount}, 0) else 0 end), 0)`,
      cashbackPaidVnd: sql<number>`coalesce(sum(case when ${orders.status} = 'paid' then coalesce(${orders.cashbackAmount}, 0) else 0 end), 0)`,
    })
    .from(orders)
    .get();

  return {
    totalCustomers: 0,
    totalEmployees: 0,
    ordersTotal: row?.total ?? 0,
    ordersAwaiting: row?.awaiting ?? 0,
    ordersApproved: row?.approved ?? 0,
    ordersPaid: row?.paid ?? 0,
    ordersRejected: row?.rejected ?? 0,
    gmvVnd: row?.gmvVnd ?? 0,
    grossCommissionVnd: row?.grossCommissionVnd ?? 0,
    cashbackPipelineVnd: row?.cashbackPipelineVnd ?? 0,
    cashbackReadyVnd: row?.cashbackReadyVnd ?? 0,
    cashbackPaidVnd: row?.cashbackPaidVnd ?? 0,
  };
}

function dailyTrends(db: Db): MetricsTrend[] {
  const day = sql`substr(coalesce(${orders.recordedAt}, ${orders.approvedAt}), 1, 10)`;
  return db
    .select({
      day: sql<string>`${day}`,
      ordersCount: sql<number>`count(*)`,
      gmvVnd: sql<number>`coalesce(sum(${orders.orderValue}), 0)`,
      commissionVnd: sql<number>`coalesce(sum(case when ${orders.status} != 'rejected' then coalesce(${orders.approvedCommission}, ${orders.estimatedCommission}, 0) else 0 end), 0)`,
      cashbackVnd: sql<number>`coalesce(sum(case when ${orders.status} != 'rejected' then coalesce(${orders.cashbackAmount}, 0) else 0 end), 0)`,
    })
    .from(orders)
    .where(sql`coalesce(${orders.recordedAt}, ${orders.approvedAt}) is not null`)
    .groupBy(day)
    .orderBy(day)
    .all();
}

export function computeMetrics(db: Db): Metrics {
  const summary = orderSummary(db);
  summary.totalCustomers = countCustomers(db, ["user"]);
  summary.totalEmployees = countCustomers(db, ["admin", "employee"]);
  return { summary, trends: dailyTrends(db) };
}
