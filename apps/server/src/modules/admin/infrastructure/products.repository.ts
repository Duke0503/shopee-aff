import { eq, sql, type SQL } from "drizzle-orm";

import type { Db } from "../../../shared/database/connection";
import { customers, linkRequests, orders, productsCache } from "../../../shared/database/schema";
import type { Page } from "../application/pagination";

/** The four values from one product row that link a request or order to it. */
export interface ProductMatch {
  itemId: string;
  namePrefix: string;
  affiliateUrl: string;
  canonicalUrl: string;
}

export interface ProductsQuery extends Page {
  search: string;
  sortBy: string;
  sortOrder: "asc" | "desc";
}

const like = (value: string): string => `%${value}%`;

/**
 * How many orders trace back to this product. The old console matched an order
 * to a product through its link request, because an order carries no item id of
 * its own; that is the same join kept here.
 */
const PRODUCT_ORDER_COUNT = sql<number>`(
  SELECT COUNT(*)
    FROM orders po
    LEFT JOIN link_requests lr ON lr.request_id = po.request_id
   WHERE lr.source_url LIKE '%' || ${productsCache.itemId} || '%'
      OR lr.estimate_detail LIKE '%' || ${productsCache.itemId} || '%'
)`;

/**
 * Whether a link request or order belongs to this product: its item id appears
 * in the request's source URL or estimate detail, the product name (first 20
 * characters) appears in the estimate detail, or the exact affiliate or
 * canonical URL is on the request. Ports the match in `_admin_products`.
 */
function matchCondition(match: ProductMatch): SQL {
  return sql`(
    ${linkRequests.sourceUrl} LIKE ${like(match.itemId)}
    OR ${linkRequests.estimateDetail} LIKE ${like(match.itemId)}
    OR (${match.namePrefix} <> '' AND ${linkRequests.estimateDetail} LIKE ${like(match.namePrefix)})
    OR ${linkRequests.affiliateUrl} = ${match.affiliateUrl || "___NO_AFF___"}
    OR ${linkRequests.sourceUrl} = ${match.canonicalUrl || "___NO_CANON___"}
  )`;
}

function searchCondition(search: string): SQL | undefined {
  if (!search) return undefined;
  return sql`(lower(${productsCache.name}) LIKE ${like(search)} OR ${productsCache.itemId} LIKE ${like(search)})`;
}

/**
 * The requested sort, matching the old console. Sorting money columns upward
 * puts the unknown values last rather than first, so "cheapest" is not a wall
 * of blanks.
 */
function orderBy(query: ProductsQuery): SQL[] {
  const direction = query.sortOrder === "asc" ? sql`asc` : sql`desc`;

  switch (query.sortBy) {
    case "price":
    case "commission":
    case "cashback":
    case "shopee_rate":
    case "seller_rate": {
      const column =
        query.sortBy === "price"
          ? productsCache.price
          : query.sortBy === "commission"
            ? productsCache.totalCommission
            : query.sortBy === "cashback"
              ? productsCache.cashback
              : query.sortBy === "shopee_rate"
                ? productsCache.shopeeRate
                : productsCache.sellerRate;
      return query.sortOrder === "asc"
        ? [sql`case when ${column} is null then 1 else 0 end`, sql`${column} asc`]
        : [sql`${column} desc`];
    }
    case "requests":
    case "request_count":
      return [sql`${productsCache.requestCount} ${direction}`];
    case "orders":
    case "order_count":
      return [sql`${PRODUCT_ORDER_COUNT} ${direction}`];
    case "updated_at":
    case "last_requested_at":
      return [sql`${productsCache.updatedAt} ${direction}`];
    case "name":
      return [sql`${productsCache.name} ${direction}`];
    default:
      return [sql`${productsCache.requestCount} desc`, sql`${productsCache.updatedAt} desc`];
  }
}

export interface ProductRow {
  itemId: string;
  shopId: string | null;
  name: string | null;
  price: number | null;
  priceFormatted: string | null;
  shopeeRate: number | null;
  sellerRate: number | null;
  shopeePart: number | null;
  shopeePartFormatted: string | null;
  sellerPart: number | null;
  sellerPartFormatted: string | null;
  totalCommission: number | null;
  commissionFormatted: string | null;
  cashback: number | null;
  cashbackFormatted: string | null;
  ratePercent: string | null;
  affiliateUrl: string | null;
  canonicalUrl: string | null;
  requestCount: number | null;
  updatedAt: string;
  imageUrl: string | null;
  orderCount: number;
}

export function countProducts(db: Db, search: string): number {
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(productsCache)
      .where(searchCondition(search))
      .get()?.n ?? 0
  );
}

export function listProductRows(db: Db, query: ProductsQuery): ProductRow[] {
  return db
    .select({
      itemId: productsCache.itemId,
      shopId: productsCache.shopId,
      name: productsCache.name,
      price: productsCache.price,
      priceFormatted: productsCache.priceFormatted,
      shopeeRate: productsCache.shopeeRate,
      sellerRate: productsCache.sellerRate,
      shopeePart: productsCache.shopeePart,
      shopeePartFormatted: productsCache.shopeePartFormatted,
      sellerPart: productsCache.sellerPart,
      sellerPartFormatted: productsCache.sellerPartFormatted,
      totalCommission: productsCache.totalCommission,
      commissionFormatted: productsCache.commissionFormatted,
      cashback: productsCache.cashback,
      cashbackFormatted: productsCache.cashbackFormatted,
      ratePercent: productsCache.ratePercent,
      affiliateUrl: productsCache.affiliateUrl,
      canonicalUrl: productsCache.canonicalUrl,
      requestCount: productsCache.requestCount,
      updatedAt: productsCache.updatedAt,
      imageUrl: productsCache.imageUrl,
      orderCount: PRODUCT_ORDER_COUNT,
    })
    .from(productsCache)
    .where(searchCondition(query.search))
    .orderBy(...orderBy(query))
    .limit(query.limit)
    .offset(query.offset)
    .all();
}

export interface RequesterRow {
  customerId: string;
  customerCode: string | null;
  displayName: string | null;
  zaloUserId: string | null;
  bankName: string | null;
  bankAccount: string | null;
  accountHolder: string | null;
  lastRequestedAt: string | null;
  requestCount: number;
}

/** Everyone who asked for this product, most recent request first. */
export function requestersFor(db: Db, match: ProductMatch): RequesterRow[] {
  const lastRequestedAt = sql<string | null>`max(${linkRequests.createdAt})`;
  return db
    .select({
      customerId: linkRequests.customerId,
      customerCode: customers.customerCode,
      displayName: customers.displayName,
      zaloUserId: customers.zaloUserId,
      bankName: customers.bankName,
      bankAccount: customers.bankAccount,
      accountHolder: customers.accountHolder,
      lastRequestedAt,
      requestCount: sql<number>`count(${linkRequests.requestId})`,
    })
    .from(linkRequests)
    .leftJoin(customers, eq(customers.customerId, linkRequests.customerId))
    .where(matchCondition(match))
    .groupBy(linkRequests.customerId)
    .orderBy(sql`${lastRequestedAt} desc`)
    .all();
}

export interface BuyerRow {
  orderId: string;
  customerId: string | null;
  customerCode: string | null;
  displayName: string | null;
  zaloUserId: string | null;
  bankName: string | null;
  bankAccount: string | null;
  accountHolder: string | null;
  orderValue: number | null;
  approvedCommission: number | null;
  estimatedCommission: number | null;
  cashbackAmount: number | null;
  status: string;
  orderDate: string | null;
}

/** Orders traced back to this product, newest first. */
export function buyersFor(db: Db, match: ProductMatch): BuyerRow[] {
  const orderDate = sql<string | null>`coalesce(${orders.recordedAt}, ${orders.approvedAt})`;
  return db
    .select({
      orderId: orders.orderId,
      customerId: orders.customerId,
      customerCode: customers.customerCode,
      displayName: customers.displayName,
      zaloUserId: customers.zaloUserId,
      bankName: customers.bankName,
      bankAccount: customers.bankAccount,
      accountHolder: customers.accountHolder,
      orderValue: orders.orderValue,
      approvedCommission: orders.approvedCommission,
      estimatedCommission: orders.estimatedCommission,
      cashbackAmount: orders.cashbackAmount,
      status: orders.status,
      orderDate,
    })
    .from(orders)
    .leftJoin(customers, eq(customers.customerId, orders.customerId))
    .leftJoin(linkRequests, eq(linkRequests.requestId, orders.requestId))
    .where(matchCondition(match))
    .orderBy(sql`${orderDate} desc`)
    .all();
}
