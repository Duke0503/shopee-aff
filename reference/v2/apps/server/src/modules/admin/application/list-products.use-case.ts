import { splitCommission } from "@mmo/money";

import { periodIsWithheld } from "../../../shared/config/period-is-withheld";
import type { Db } from "../../../shared/database/connection";
import {
  buyersFor,
  countProducts,
  listProductRows,
  requestersFor,
  type BuyerRow,
  type ProductMatch,
  type ProductRow,
} from "../infrastructure/products.repository";
import { paginationMeta, type Page } from "./pagination";

/**
 * The product list for the staff area. Ports `_admin_products`: the cached
 * product rows, plus who asked for each one and who bought it.
 *
 * Aggregates come from STORED columns; the only money computed here is the
 * fallback cashback for an order that has none yet, and that goes through the
 * shared `splitCommission`, never an inline formula.
 */
export interface ProductsQuery extends Page {
  search: string;
  sortBy: string;
  sortOrder: "asc" | "desc";
}

const matchFor = (row: ProductRow): ProductMatch => ({
  itemId: row.itemId,
  namePrefix: (row.name ?? "").slice(0, 20),
  affiliateUrl: row.affiliateUrl ?? "",
  canonicalUrl: row.canonicalUrl ?? "",
});

function buyerView(buyer: BuyerRow, cashbackRate: number) {
  const commission = buyer.approvedCommission ?? buyer.estimatedCommission ?? 0;
  return {
    orderId: buyer.orderId,
    customerId: buyer.customerId,
    customerCode: buyer.customerCode,
    displayName: buyer.displayName,
    zaloUserId: buyer.zaloUserId,
    bankName: buyer.bankName,
    bankAccount: buyer.bankAccount,
    accountHolder: buyer.accountHolder,
    orderValue: buyer.orderValue,
    approvedCommission: buyer.approvedCommission,
    estimatedCommission: buyer.estimatedCommission,
    cashbackAmount:
      buyer.cashbackAmount ?? splitCommission(commission, cashbackRate, periodIsWithheld()).customerReceives,
    status: buyer.status,
    orderDate: buyer.orderDate,
  };
}

export function listProducts(db: Db, query: ProductsQuery, cashbackRate: number) {
  const total = countProducts(db, query.search);

  const products = listProductRows(db, query).map((row) => {
    const match = matchFor(row);
    const requesters = requestersFor(db, match);
    const buyers = buyersFor(db, match).map((buyer) => buyerView(buyer, cashbackRate));
    const requested = requesters.reduce((sum, requester) => sum + requester.requestCount, 0);

    return {
      ...row,
      requesters,
      requestCount: requested,
      lastRequestedAt: requested > 0 ? (requesters[0]?.lastRequestedAt ?? null) : null,
      buyers,
      orderCount: buyers.length,
      totalBoughtGmv: buyers.reduce((sum, buyer) => sum + (buyer.orderValue ?? 0), 0),
    };
  });

  return { products, pagination: paginationMeta(query, total) };
}
