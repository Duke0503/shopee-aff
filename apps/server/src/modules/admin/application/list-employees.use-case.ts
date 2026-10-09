import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { customers } from "../../../shared/database/schema";
import { paginationMeta, type Page } from "./pagination";

/**
 * The employee list: everyone who can sign into the console. Ports
 * `_admin_employees`, including the paging, search and sort behaviour.
 */
export interface EmployeesQuery extends Page {
  search: string;
  role: string;
  sortBy: string;
  sortOrder: "asc" | "desc";
}

export interface EmployeeRow {
  customerId: string;
  displayName: string | null;
  role: string;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
  loginCount: number;
}

function orderBy(query: EmployeesQuery): SQL {
  const direction = query.sortOrder === "asc" ? sql`asc` : sql`desc`;
  switch (query.sortBy) {
    case "name":
      return sql`coalesce(${customers.displayName}, ${customers.customerId}) ${direction}`;
    case "customer_id":
      return sql`${customers.customerId} ${direction}`;
    case "role":
      return sql`${customers.role} ${direction}`;
    case "status":
      return sql`${customers.status} ${direction}`;
    case "login_count":
      return sql`${customers.loginCount} ${direction}`;
    case "last_login":
    case "last_login_at":
      return sql`coalesce(${customers.lastLoginAt}, ${customers.createdAt}) ${direction}`;
    case "created_at":
      return sql`${customers.createdAt} ${direction}`;
    default:
      return sql`${customers.createdAt} desc`;
  }
}

function whereFor(query: EmployeesQuery) {
  const conditions = [inArray(customers.role, ["admin", "employee"])];
  if (query.search) {
    const pattern = `%${query.search}%`;
    conditions.push(
      or(
        sql`lower(${customers.customerId}) like ${pattern}`,
        sql`lower(coalesce(${customers.displayName}, '')) like ${pattern}`,
      )!,
    );
  }
  if (query.role === "admin" || query.role === "employee") {
    conditions.push(eq(customers.role, query.role));
  }
  return and(...conditions);
}

export function listEmployees(
  db: Db,
  query: EmployeesQuery,
): { employees: EmployeeRow[]; pagination: ReturnType<typeof paginationMeta> } {
  const where = whereFor(query);
  const total =
    db.select({ n: sql<number>`count(*)` }).from(customers).where(where).get()?.n ?? 0;

  const employees = db
    .select({
      customerId: customers.customerId,
      displayName: customers.displayName,
      role: customers.role,
      status: customers.status,
      createdAt: customers.createdAt,
      lastLoginAt: customers.lastLoginAt,
      loginCount: customers.loginCount,
    })
    .from(customers)
    .where(where)
    .orderBy(orderBy(query))
    .limit(query.limit)
    .offset(query.offset)
    .all();

  return { employees, pagination: paginationMeta(query, total) };
}
