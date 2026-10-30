import { and, eq, or, sql, type SQL } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { customers, linkRequests } from "../../../shared/database/schema";
import { paginationMeta, type Page } from "./pagination";

/**
 * The customer list for the staff area. Ports `_admin_users`. Aggregates come
 * from STORED columns only (`cashback_amount`, `approved_commission`): no money
 * is recalculated here, so the dashboard can never disagree with the ledger.
 */
export interface UsersQuery extends Page {
  search: string;
  bank: string;
  sortBy: string;
  sortOrder: "asc" | "desc";
}

export interface UserRow {
  customerId: string;
  customerCode: string | null;
  displayName: string | null;
  zaloUserId: string | null;
  bankName: string | null;
  bankAccount: string | null;
  accountHolder: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  loginCount: number;
  status: string;
  orderCount: number;
  totalCashback: number;
  awaitingAmount: number;
  readyAmount: number;
  paidAmount: number;
  lastBotActivity: string | null;
  recentRequests: Array<{ name: string; createdAt: string; affiliateUrl: string | null }>;
}

function orderBy(query: UsersQuery): SQL {
  const direction = query.sortOrder === "asc" ? sql`asc` : sql`desc`;
  switch (query.sortBy) {
    case "orders":
    case "order_count":
      return sql`order_count ${direction}`;
    case "total_cashback":
      return sql`total_cashback ${direction}`;
    case "awaiting_amount":
      return sql`awaiting_amount ${direction}`;
    case "ready_amount":
      return sql`ready_amount ${direction}`;
    case "paid_amount":
      return sql`paid_amount ${direction}`;
    case "login_count":
      return sql`${customers.loginCount} ${direction}`;
    case "last_login":
    case "last_login_at":
    case "last_bot_activity":
      return sql`last_bot_activity ${direction}`;
    case "created_at":
      return sql`${customers.createdAt} ${direction}`;
    case "name":
      return sql`coalesce(${customers.displayName}, ${customers.customerId}) ${direction}`;
    case "customer_id":
      return sql`${customers.customerId} ${direction}`;
    default:
      return sql`coalesce(${customers.lastLoginAt}, ${customers.createdAt}) desc`;
  }
}

function whereFor(query: UsersQuery) {
  const conditions = [eq(customers.role, "user")];
  if (query.search) {
    const pattern = `%${query.search}%`;
    conditions.push(
      or(
        sql`lower(${customers.customerId}) like ${pattern}`,
        sql`lower(coalesce(${customers.customerCode}, '')) like ${pattern}`,
        sql`lower(coalesce(${customers.displayName}, '')) like ${pattern}`,
        sql`lower(coalesce(${customers.zaloUserId}, '')) like ${pattern}`,
        sql`lower(coalesce(${customers.bankAccount}, '')) like ${pattern}`,
        sql`lower(coalesce(${customers.bankName}, '')) like ${pattern}`,
      )!,
    );
  }
  if (query.bank === "has_bank") {
    conditions.push(sql`${customers.bankAccount} is not null and ${customers.bankAccount} != ''`);
  } else if (query.bank === "no_bank") {
    conditions.push(sql`(${customers.bankAccount} is null or ${customers.bankAccount} = '')`);
  }
  return and(...conditions);
}

/** Per-customer aggregates, all from stored columns. Outer columns are written
 * fully qualified (`customers.customer_id`) because inside a raw subquery an
 * unqualified name would bind to the inner table and compare a row with itself. */
const OUTER_ID = sql.raw("customers.customer_id");
const OUTER_ZALO = sql.raw("customers.zalo_user_id");

const userColumns = {
  customerId: customers.customerId,
  customerCode: customers.customerCode,
  displayName: customers.displayName,
  zaloUserId: customers.zaloUserId,
  bankName: customers.bankName,
  bankAccount: customers.bankAccount,
  accountHolder: customers.accountHolder,
  createdAt: customers.createdAt,
  lastLoginAt: customers.lastLoginAt,
  loginCount: customers.loginCount,
  status: customers.status,
  orderCount: sql<number>`(select count(*) from orders o where o.customer_id = ${OUTER_ID})`,
  totalCashback: sql<number>`(select coalesce(sum(case when o.status != 'rejected' then coalesce(o.cashback_amount, 0) else 0 end), 0) from orders o where o.customer_id = ${OUTER_ID})`,
  awaitingAmount: sql<number>`(select coalesce(sum(coalesce(o.cashback_amount, 0)), 0) from orders o where o.customer_id = ${OUTER_ID} and o.status = 'awaiting_approval')`,
  readyAmount: sql<number>`(select coalesce(sum(coalesce(o.cashback_amount, 0)), 0) from orders o where o.customer_id = ${OUTER_ID} and o.status = 'approved' and o.paid_at is null)`,
  paidAmount: sql<number>`(select coalesce(sum(coalesce(o.cashback_amount, 0)), 0) from orders o where o.customer_id = ${OUTER_ID} and o.status = 'paid')`,
  lastBotActivity: sql<string | null>`(select max(created_at) from (
    select created_at from link_requests where customer_id = ${OUTER_ID}
    union all
    select created_at from activity_logs where customer_id = ${OUTER_ID}
      or (${OUTER_ZALO} is not null and ${OUTER_ZALO} != '' and customer_id = ${OUTER_ZALO})))`,
};

/** The last few links this customer asked for, for the detail panel. */
function recentRequests(db: Db, customerId: string): UserRow["recentRequests"] {
  return db
    .select({
      sourceUrl: linkRequests.sourceUrl,
      affiliateUrl: linkRequests.affiliateUrl,
      createdAt: linkRequests.createdAt,
    })
    .from(linkRequests)
    .where(eq(linkRequests.customerId, customerId))
    .orderBy(sql`${linkRequests.createdAt} desc`)
    .limit(3)
    .all()
    .map((row) => ({ name: row.sourceUrl, createdAt: row.createdAt, affiliateUrl: row.affiliateUrl }));
}

export function listUsers(
  db: Db,
  query: UsersQuery,
): { users: UserRow[]; pagination: ReturnType<typeof paginationMeta> } {
  const where = whereFor(query);
  const total =
    db.select({ n: sql<number>`count(*)` }).from(customers).where(where).get()?.n ?? 0;

  const users = db
    .select(userColumns)
    .from(customers)
    .where(where)
    .orderBy(orderBy(query))
    .limit(query.limit)
    .offset(query.offset)
    .all()
    .map((row) => ({ ...row, recentRequests: recentRequests(db, row.customerId) }));

  return { users, pagination: paginationMeta(query, total) };
}
