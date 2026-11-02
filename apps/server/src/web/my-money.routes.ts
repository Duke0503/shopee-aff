/**
 * The signed-in customer's money and orders on the public listener (FR-15, FR-37, FR-18, AD-6,
 * AD-12, AD-18, INV-5; Stories 7.3 and 7.4). Like the admin's customer page, a page meeting
 * identity, payouts and orders is composed here instead of inside one module.
 *
 *   GET /api/me/money     balance, bank card and clawed-back orders of the session's customer
 *   GET /api/me/orders    that customer's order lines on the list contract
 *   GET /api/me/payouts   that customer's payouts on the list contract
 *
 * The customer is the one the session cookie names, never a parameter: the routes take no id, and
 * a `customerId` filter is not part of either list, so another customer's data cannot be asked
 * for. The scope is the survivor and its aliases, resolved here (a merged customer's records are
 * all theirs). The figures are the admin customer page's own (`customerMoney`, i.e. `getBalances`)
 * with the next payout's netting by `nextPayoutNetting`, the rule `/sodu` answers with, and the
 * parts of the gross (`grossParts`), so the card can show payable as approved + refunded -
 * deducted, each a figure of the server. The order lines read only the open clawbacks. A missing
 * or ended session is 401; nothing is ever cached.
 */
import { MY_MONEY_PATH, MY_ORDERS_PATH, MY_PAYOUTS_PATH, myMoneySchema, myOrdersResponseSchema, myPayoutsResponseSchema, type MyMoney } from "@cashback/contracts";
import type { Clock } from "@cashback/core";
import type { FastifyReply, FastifyRequest } from "fastify";

import { customerCodeOf, customerKeys, customerSessionOf } from "../modules/identity/index";
import { answerMyOrders, orderCardsOf } from "../modules/orders/index";
import { answerMyPayouts, customerMoney, grossParts, nextPayoutNetting, openClawbacks } from "../modules/payouts/index";
import type { Ledger, LedgerDb } from "../platform/db/ledger";
import { HttpError } from "../platform/http/error-envelope";
import type { PublicRoutes } from "../platform/http/servers";
import { CUSTOMER_SESSION_COOKIE, readCookie } from "../platform/http/session-cookie";

export interface MyMoneyRouteDeps {
  readonly ledger: Ledger;
  readonly clock: Clock;
}

interface Scope {
  readonly customerId: string;
  readonly keys: readonly string[];
}

/** The session's customer and its stored ids; no session is 401. */
function sessionScope(db: LedgerDb, request: FastifyRequest, reply: FastifyReply, clock: Clock): Scope {
  void reply.header("cache-control", "no-store");
  const customerId = customerSessionOf(db, readCookie(request.headers.cookie, CUSTOMER_SESSION_COOKIE), clock);
  if (customerId === null) throw new HttpError("unauthorized", "error.unauthorized");
  return { customerId, keys: customerKeys(db, customerId)?.keys ?? [customerId] };
}

/** Each clawed-back order's open clawback, by order id: the clawbacks alone, under the scope's ids. */
function deductionsOf(db: LedgerDb, scope: Scope): Map<string, number> {
  const open = new Map<string, number>();
  for (const c of openClawbacks(db, scope.keys)) {
    if (c.orderId !== null) open.set(c.orderId, c.open);
  }
  return open;
}

export function myMoneyOf(db: LedgerDb, scope: Scope, clock: Clock): MyMoney {
  const money = customerMoney(db, scope.customerId, scope.keys, clock);
  const { payable, waiting, paid } = money.balance;
  const cards = orderCardsOf(db, money.clawbacks.flatMap((c) => (c.orderId === null ? [] : [c.orderId])));
  return {
    customerCode: customerCodeOf(db, scope.customerId) ?? "",
    balance: { payable, waiting, paid, ...grossParts(db, scope.keys), ...nextPayoutNetting(money.balance) },
    bank: money.bank === null ? null : { bankName: money.bank.bankName, holderName: money.bank.holderName, lastFour: money.bank.lastFour, held: money.bank.held },
    deductions: money.clawbacks.map((c) => {
      const card = c.orderId === null ? undefined : cards.get(c.orderId);
      return { deductionId: c.clawbackId, orderId: c.orderId, productName: card?.productName ?? null, productImageUrl: card?.productImageUrl ?? null, amount: c.open };
    }),
    asOf: clock.now(),
  };
}

export function myMoneyRoutes({ ledger, clock }: MyMoneyRouteDeps): PublicRoutes {
  const db = ledger.db;
  return (app) => {
    app.get(MY_MONEY_PATH, async (request, reply) => myMoneySchema.parse(myMoneyOf(db, sessionScope(db, request, reply, clock), clock)));
    app.get(MY_ORDERS_PATH, async (request, reply) => {
      const scope = sessionScope(db, request, reply, clock);
      return myOrdersResponseSchema.parse(answerMyOrders(db, scope.keys, request.query, clock, deductionsOf(db, scope)));
    });
    app.get(MY_PAYOUTS_PATH, async (request, reply) => {
      const scope = sessionScope(db, request, reply, clock);
      return myPayoutsResponseSchema.parse(answerMyPayouts(db, scope.keys, request.query, clock));
    });
  };
}
