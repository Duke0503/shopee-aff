/**
 * The Customers screen and one customer's page on the admin desk (FR-26, FR-15, FR-37, AD-6,
 * Story 4.14). Any staff role may read them (FR-24); nothing here writes. A customer's page meets
 * four modules (identity's profile, payouts' money, orders, linking), so it is composed here, like
 * the desk itself, instead of inside one module.
 *
 *   GET /api/admin/customers                                the Customers list on the list contract
 *   GET /api/admin/customers/:customerKey                   one customer: profile, balance, flags, bank, clawbacks, tab counts
 *   GET /api/admin/customers/:customerKey/orders            that customer's orders (the Orders list, scoped)
 *   GET /api/admin/customers/:customerKey/link-requests     that customer's link requests
 *   GET /api/admin/customers/:customerKey/payouts           that customer's payouts, voided ones included
 *
 * `customerKey` is an id, a code, an alias or a Zalo id; it resolves to the survivor once, and each
 * scoped list covers the survivor's id and its aliases, so a merged customer's records are all
 * there. The scope is set by the server; the browser cannot widen it.
 */
import {
  adminCustomersResponseSchema,
  adminLinkRequestsResponseSchema,
  adminOrdersResponseSchema,
  customerKeyParamsSchema,
  customerPageSchema,
  payoutHistoryResponseSchema,
  type CustomerPage,
} from "@cashback/contracts";
import type { Clock } from "@cashback/core";
import type { FastifyRequest } from "fastify";

import { customerKeys, customerProfileOf, deskCustomerOf } from "../modules/identity/index";
import { answerCustomerLinkRequests, linkRequestCountOf } from "../modules/linking/index";
import { answerCustomerOrders, orderCountOf } from "../modules/orders/index";
import {
  answerCustomerPayouts,
  answerCustomersList,
  customerMoney,
} from "../modules/payouts/index";
import type { Ledger, LedgerDb } from "../platform/db/ledger";
import { HttpError } from "../platform/http/error-envelope";
import type { StaffRoutes } from "../platform/http/staff-routes";

export interface CustomerDeskRouteDeps {
  readonly ledger: Ledger;
  readonly clock: Clock;
}

interface Scope {
  readonly customerId: string;
  readonly keys: readonly string[];
}

const NOT_FOUND = (): HttpError => new HttpError("not_found", "error.customer.not_found");

/** The desk customer behind a key of any kind and its stored ids; staff accounts and the guest account have no page. */
function scopeOf(db: LedgerDb, request: FastifyRequest): Scope {
  const params = customerKeyParamsSchema.safeParse(request.params);
  if (!params.success) throw NOT_FOUND();
  const found = deskCustomerOf(db, params.data.customerKey);
  if (found === null) throw NOT_FOUND();
  // An erased customer's records stay under its own id (FR-35); a live one's also under its aliases.
  const keys =
    found.status === "ERASED"
      ? [found.customerId]
      : (customerKeys(db, found.customerId)?.keys ?? [found.customerId]);
  return { customerId: found.customerId, keys };
}

export function customerPage(db: LedgerDb, scope: Scope, clock: Clock): CustomerPage {
  const profile = customerProfileOf(db, scope.customerId);
  if (profile === null) throw NOT_FOUND();
  const money = customerMoney(db, scope.customerId, scope.keys, clock);
  return {
    customerId: profile.customerId,
    customerCode: profile.customerCode,
    customerName: profile.displayName,
    status: profile.status,
    zaloUserId: profile.zaloUserId,
    joinedAt: profile.createdAt,
    erasedAt: profile.erasedAt,
    balance: money.balance,
    flags: money.flags,
    bank: money.bank,
    clawbacks: money.clawbacks,
    counts: {
      orders: orderCountOf(db, scope.keys),
      linkRequests: linkRequestCountOf(db, scope.keys),
      payouts: money.payoutCount,
    },
  };
}

export function customerDeskRoutes({ ledger, clock }: CustomerDeskRouteDeps): StaffRoutes {
  const db = ledger.db;
  return (add) => {
    add({
      method: "GET",
      url: "/api/admin/customers",
      handler: async (request) =>
        adminCustomersResponseSchema.parse(answerCustomersList(db, request.query, clock)),
    });
    add({
      method: "GET",
      url: "/api/admin/customers/:customerKey",
      handler: async (request) =>
        customerPageSchema.parse(customerPage(db, scopeOf(db, request), clock)),
    });
    add({
      method: "GET",
      url: "/api/admin/customers/:customerKey/orders",
      handler: async (request) =>
        adminOrdersResponseSchema.parse(
          answerCustomerOrders(db, scopeOf(db, request).keys, request.query, clock),
        ),
    });
    add({
      method: "GET",
      url: "/api/admin/customers/:customerKey/link-requests",
      handler: async (request) =>
        adminLinkRequestsResponseSchema.parse(
          answerCustomerLinkRequests(db, scopeOf(db, request).keys, request.query, clock),
        ),
    });
    add({
      method: "GET",
      url: "/api/admin/customers/:customerKey/payouts",
      handler: async (request) =>
        payoutHistoryResponseSchema.parse(
          answerCustomerPayouts(db, scopeOf(db, request).keys, request.query, clock),
        ),
    });
  };
}
