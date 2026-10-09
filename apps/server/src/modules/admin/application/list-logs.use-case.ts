import { and, eq, or, sql, type SQL } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { activityLogs, customers } from "../../../shared/database/schema";
import { paginationMeta, type Page } from "./pagination";

/**
 * The activity log for the staff area. Ports `_admin_logs`: paging, a text
 * search over the actor and the action, and an optional exact action filter.
 */
export interface LogsQuery extends Page {
  search: string;
  action: string;
  sortOrder: "asc" | "desc";
}

export interface LogRow {
  id: number;
  customerId: string | null;
  displayName: string | null;
  action: string;
  path: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  detail: string | null;
  createdAt: string;
}

function whereFor(query: LogsQuery): SQL | undefined {
  const conditions: SQL[] = [];
  if (query.search) {
    const pattern = `%${query.search}%`;
    conditions.push(
      or(
        sql`lower(coalesce(${activityLogs.customerId}, '')) like ${pattern}`,
        sql`lower(coalesce(${customers.displayName}, '')) like ${pattern}`,
        sql`lower(${activityLogs.action}) like ${pattern}`,
        sql`lower(coalesce(${activityLogs.path}, '')) like ${pattern}`,
      )!,
    );
  }
  if (query.action && query.action !== "all") {
    conditions.push(eq(activityLogs.action, query.action));
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

export function listLogs(
  db: Db,
  query: LogsQuery,
): { logs: LogRow[]; pagination: ReturnType<typeof paginationMeta> } {
  const where = whereFor(query);
  const total =
    db
      .select({ n: sql<number>`count(*)` })
      .from(activityLogs)
      .leftJoin(customers, eq(activityLogs.customerId, customers.customerId))
      .where(where)
      .get()?.n ?? 0;

  const direction = query.sortOrder === "asc" ? sql`asc` : sql`desc`;
  const logs = db
    .select({
      id: activityLogs.id,
      customerId: activityLogs.customerId,
      displayName: customers.displayName,
      action: activityLogs.action,
      path: activityLogs.path,
      ipAddress: activityLogs.ipAddress,
      userAgent: activityLogs.userAgent,
      detail: activityLogs.detail,
      createdAt: activityLogs.createdAt,
    })
    .from(activityLogs)
    .leftJoin(customers, eq(activityLogs.customerId, customers.customerId))
    .where(where)
    .orderBy(sql`${activityLogs.createdAt} ${direction}`)
    .limit(query.limit)
    .offset(query.offset)
    .all();

  return { logs, pagination: paginationMeta(query, total) };
}
